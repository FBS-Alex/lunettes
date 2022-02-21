import {
    PhoneNumberValidateCommand,
    PinpointClient,
    SendMessagesCommand,
    UpdateCampaignCommand,
    UpdateEndpointCommand,
    UpdateSegmentCommand
} from '@aws-sdk/client-pinpoint';
import crypto from 'crypto';


const pinpoint = new PinpointClient({region: process.env.region});

// Make sure the SMS channel is enabled for the projectId that you specify.
// See: https://docs.aws.amazon.com/pinpoint/latest/userguide/channels-sms-setup.html
const projectId = process.env.projectId;

const messageType = "TRANSACTIONAL";

export const handler = async (event) => {
    console.log('Received event:', event);
    try {
        const data = await validateNumber(event.data);
        if (data.NumberValidateResponse.PhoneTypeCode === 0) {
            const dateTime = parseDateTime(event.data.dateTime);
            const segmentName = event.data.itemName + '_' + dateTime.toISOString();
            const endpointId = await updateEndpoint(data, event.data, segmentName);
            await sendConfirmation(endpointId, event.data.templateName);
            if (new Date().addDays(1).getTime() < dateTime.getTime()) {
                const segmentId = await updateSegment(segmentName);
                await updateCampaigns(segmentId, segmentName, dateTime);
            }
        } else {
            console.log("Received a phone number that isn't capable of receiving " +
                "SMS messages. No endpoint created.");
        }
    } catch (e) {
        console.log(e, e.stack);
    }
};

async function validateNumber(eventData) {
    let destinationNumber = eventData.phoneNumber;
    if (destinationNumber.length === 11) {
        destinationNumber = "+81" + destinationNumber;
    }
    const params = {
        NumberValidateRequest: {
            IsoCountryCode: 'JA',
            PhoneNumber: destinationNumber
        }
    };
    const data = await pinpoint.send(new PhoneNumberValidateCommand(params));
    console.log(data);
    return data;
}

async function updateEndpoint(data, eventData, source) {
    const destinationNumber = data.NumberValidateResponse.CleansedPhoneNumberE164;
    const endpointId = destinationNumber.substring(1) + '_' + crypto.createHash('sha256', {outputLength: 32}).update(eventData.itemName).digest('hex');

    const params = {
        ApplicationId: projectId,
        // The Endpoint ID is equal to the cleansed phone number minus the leading
        // plus sign. This makes it easier to easily update the endpoint later.
        EndpointId: endpointId,
        EndpointRequest: {
            ChannelType: 'SMS',
            Address: destinationNumber,
            OptOut: 'NONE',
            Location: {
                PostalCode: data.NumberValidateResponse.ZipCode,
                City: data.NumberValidateResponse.City,
                Country: data.NumberValidateResponse.CountryCodeIso2,
            },
            Demographic: {
                Timezone: data.NumberValidateResponse.Timezone
            },
            Attributes: {
                Source: [
                    source
                ],
                ItemName: [
                    eventData.itemName
                ]
            },
            User: {
                UserAttributes: {
                    Name: [
                        eventData.name
                    ]
                }
            }
        }
    };
    const response = await pinpoint.send(new UpdateEndpointCommand(params));
    console.log(response);
    return endpointId;
}

async function sendConfirmation(endpointId, templateName) {
    const params = {
        ApplicationId: projectId,
        MessageRequest: {
            Endpoints: {
                [endpointId]: {}
            },
            MessageConfiguration: {
                SMSMessage: {
                    MessageType: messageType
                }
            },
            TemplateConfiguration: {
                SMSTemplate: {
                    Name: templateName
                }
            }
        }
    };

    const data = await pinpoint.send(new SendMessagesCommand(params));
    console.log("Message sent! " +
        data.MessageResponse.EndpointResult[endpointId].StatusMessage);
}

async function updateSegment(segmentName) {
    const params = {
        ApplicationId: projectId,
        SegmentId: crypto.createHash('sha256', {outputLength: 32}).update(segmentName).digest('hex'),
        WriteSegmentRequest: {
            Dimensions: {
                Attributes: {
                    'Source': {
                        Values: [
                            segmentName
                        ],
                        AttributeType: 'INCLUSIVE'
                    }
                }
            },
            Name: segmentName
        }
    };
    const data = await pinpoint.send(new UpdateSegmentCommand(params));
    console.log('Segment created/updated');
    console.log(data);
    return data.SegmentResponse.Id;
}

async function updateCampaigns(segmentId, segmentName, dateTime) {
    await updateCampaign(segmentName + '（1日前のリマインダー）', segmentId, 'lunettes_seminar_reminder_1day', dateTime.addDays(-1));
    await updateCampaign(segmentName + '（1時間前のリマインダー）', segmentId, 'lunettes_seminar_reminder_1hour', dateTime.addHours(-1));
}

async function updateCampaign(campaignName, segmentId, templateName, dateTime) {
    const params = {
        ApplicationId: projectId,
        CampaignId: crypto.createHash('sha256', {outputLength: 32}).update(campaignName).digest('hex'),
        WriteCampaignRequest: {
            MessageConfiguration: {
                SMSMessage: {
                    MessageType: messageType
                }
            },
            Name: campaignName,
            Schedule: {
                StartTime: dateTime.toISOString(),
                Frequency: 'ONCE',
                IsLocalTime: true,
                Timezone: 'UTC+09'
            },
            SegmentId: segmentId,
            TemplateConfiguration: {
                SMSTemplate: {
                    Name: templateName
                }
            }
        }
    };
    const data = await pinpoint.send(new UpdateCampaignCommand(params));
    console.log('Campaign created/updated');
    console.log(data);
}

function parseDateTime(str) {
    const match = str.match(/(\d+)[月/](\d+)日?（.）(\d+):(\d+)～/);
    const [, month, day, hour, minute] = match;
    const now = new Date();
    let year = now.getFullYear();
    if (month < now.getMonth() + 1 || (month === now.getMonth() + 1 && day < now.getDate())) {
        year++;
    }
    return new Date(year, month - 1, day, hour, minute);
}

Date.prototype.addDays = function (days) {
    const date = new Date(this.valueOf());
    date.setDate(date.getDate() + days);
    return date;
};

Date.prototype.addHours = function (h) {
    const date = new Date(this.valueOf());
    date.setTime(this.getTime() + (h * 60 * 60 * 1000));
    return date;
};
