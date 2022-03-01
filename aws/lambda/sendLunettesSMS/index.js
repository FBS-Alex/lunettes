import {
    CreateCampaignCommand,
    CreateSegmentCommand,
    GetSegmentsCommand,
    PhoneNumberValidateCommand,
    PinpointClient,
    SendMessagesCommand,
    UpdateEndpointCommand
} from '@aws-sdk/client-pinpoint';
import {createHash, parseDateTime} from './util.js';
import {CampaignConfig} from './campaign_config.js';
import {DateTime, Settings} from 'luxon';

Settings.defaultZone = 'Japan';
Settings.defaultLocale = 'ja-JP';

const pinpoint = new PinpointClient({region: process.env.region});

// Make sure the SMS channel is enabled for the projectId that you specify.
// See: https://docs.aws.amazon.com/pinpoint/latest/userguide/channels-sms-setup.html
const projectId = process.env.projectId;

const MESSAGE_TYPE = "TRANSACTIONAL";

const PAGE_SIZE = 200;

const SEGMENT_UID_TAG = 'uid';

const CAMPAIGN_NAME_MAX_LENGTH = 64;
const CAMPAIGN_CONFIGS = [
    new CampaignConfig('lunettes_seminar_reminder_1day', '（1日前）', (dateTime) => dateTime.minus({days: 1})),
    new CampaignConfig('lunettes_seminar_reminder_1hour', '（1時間前）', (dateTime) => dateTime.minus({hours: 1}))
];

export const handler = async (event) => {
    console.log('Received event:', event);
    const data = await validateNumber(event.data);
    if (data.NumberValidateResponse.PhoneTypeCode === 0) {
        const dateTime = parseDateTime(event.data.dateTime);
        let dateSuffix = '_' + dateTime.toISO(
            {
                format: 'basic',
                suppressMilliseconds: true,
                suppressSeconds: true,
                includeOffset: false
            });
        // since campaign names have a limit of 64 characters and segment name will be used in the campaign name
        // we have to calculate max length for the segment name prefix
        const segmentName = event.data.itemName.substring(0,
            CAMPAIGN_NAME_MAX_LENGTH - dateSuffix.length - Math.max(
                ...CAMPAIGN_CONFIGS.map(config => config.nameSuffix.length))) + dateSuffix;
        const segmentUid = createHash(event.data.itemName + dateSuffix);
        const endpointId = await updateEndpoint(data, event.data, segmentUid, dateTime);
        await sendConfirmation(endpointId, event.data.templateName);
        if (CAMPAIGN_CONFIGS.some(config => config.isApplicable(dateTime)) && !await segmentExists(segmentUid)) {
            const segmentId = await createSegment(segmentUid, segmentName);
            await createCampaigns(segmentId, segmentName, dateTime);
        }
    } else {
        console.log("Received a phone number that isn't capable of receiving " +
            "SMS messages. No endpoint created.");
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

async function updateEndpoint(data, eventData, source, dateTime) {
    const destinationNumber = data.NumberValidateResponse.CleansedPhoneNumberE164;
    const endpointId = destinationNumber.substring(1) + '_' + createHash(eventData.itemName);

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
                ],
                DateTime: [
                    dateTime.toLocaleString(DateTime.DATETIME_MED)
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
                    MessageType: MESSAGE_TYPE
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

async function segmentExists(uid) {
    let token = undefined;
    do {
        const params = {
            ApplicationId: projectId,
            PageSize: PAGE_SIZE.toString(),
            Token: token
        };
        const data = await pinpoint.send(new GetSegmentsCommand(params));
        if (data.SegmentsResponse.Item.some(value => value.tags && value.tags[SEGMENT_UID_TAG] === uid)) {
            return true;
        }
        token = data.SegmentsResponse.NextToken;
    } while (token);
    return false;
}

async function createSegment(segmentUid, segmentName) {
    const params = {
        ApplicationId: projectId,
        WriteSegmentRequest: {
            Dimensions: {
                Attributes: {
                    Source: {
                        Values: [
                            segmentUid
                        ],
                        AttributeType: 'INCLUSIVE'
                    }
                }
            },
            Name: segmentName,
            tags: {
                [SEGMENT_UID_TAG]: segmentUid
            }
        }
    };
    const data = await pinpoint.send(new CreateSegmentCommand(params));
    console.log('Segment created');
    console.log(data);
    return data.SegmentResponse.Id;
}

async function createCampaigns(segmentId, segmentName, dateTime) {
    await Promise.all(CAMPAIGN_CONFIGS.filter(config => config.isApplicable(dateTime)).map(
        async config => createCampaign(segmentName + config.nameSuffix, segmentId, config.template,
            config.calculateDateTime(dateTime))));
}

async function createCampaign(campaignName, segmentId, templateName, dateTime) {
    const params = {
        ApplicationId: projectId,
        WriteCampaignRequest: {
            MessageConfiguration: {
                SMSMessage: {
                    MessageType: MESSAGE_TYPE
                }
            },
            Name: campaignName,
            Schedule: {
                StartTime: dateTime.toISO(),
                Frequency: 'ONCE',
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
    const data = await pinpoint.send(new CreateCampaignCommand(params));
    console.log('Campaign created');
    console.log(data);
}