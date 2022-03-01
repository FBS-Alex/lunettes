import {
    CampaignStatus,
    DeleteCampaignCommand,
    DeleteSegmentCommand,
    GetCampaignsCommand,
    PinpointClient
} from '@aws-sdk/client-pinpoint';
import {DateTime, Duration, Settings} from 'luxon';

Settings.defaultZone = 'Japan';
Settings.defaultLocale = 'ja-JP';

const pinpoint = new PinpointClient({region: process.env.region});

// Make sure the SMS channel is enabled for the projectId that you specify.
// See: https://docs.aws.amazon.com/pinpoint/latest/userguide/channels-sms-setup.html
const projectId = process.env.projectId;

const PAGE_SIZE = 200;

const DELETION_INTERVAL = new Duration({months: 1});

export const handler = async (event) => {
    console.log('Received event:', event);
    try {
        await deleteCompletedCampaigns();
    } catch (e) {
        console.error(e, e.stack);
    }
};


async function deleteCompletedCampaigns() {
    const deletionThreshold = DateTime.local().minus(DELETION_INTERVAL);
    let token = null;
    do {
        const params = {
            ApplicationId: projectId,
            PageSize: PAGE_SIZE.toString(),
            Token: token
        };
        const data = await pinpoint.send(new GetCampaignsCommand(params));
        for (const campaign of data.CampaignsResponse.Item.filter(
            value => [CampaignStatus.DELETED, CampaignStatus.COMPLETED].includes(
                value.State.CampaignStatus) && DateTime.fromISO(value.LastModifiedDate) < deletionThreshold)) {
            try {
                await pinpoint.send(new DeleteCampaignCommand({ApplicationId: projectId, CampaignId: campaign.Id}));
                await pinpoint.send(
                    new DeleteSegmentCommand({ApplicationId: projectId, SegmentId: campaign.SegmentId}));
            } catch (e) {
                console.error(e, e.stack);
            }
        }
        token = data.CampaignsResponse.NextToken;
    } while (token);
}