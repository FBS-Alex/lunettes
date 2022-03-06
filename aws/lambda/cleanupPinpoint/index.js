import {
    CampaignStatus,
    DeleteCampaignCommand,
    DeleteSegmentCommand,
    Frequency,
    GetCampaignsCommand,
    PinpointClient
} from '@aws-sdk/client-pinpoint';
import {DateTime, Settings} from 'luxon';

Settings.defaultZone = 'Japan';
Settings.defaultLocale = 'ja-JP';

const pinpoint = new PinpointClient({region: process.env.region});

// Make sure the SMS channel is enabled for the projectId that you specify.
// See: https://docs.aws.amazon.com/pinpoint/latest/userguide/channels-sms-setup.html
const projectId = process.env.projectId;

const PAGE_SIZE = 200;

const DELETION_INTERVAL = {months: 1};

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
    let token = undefined;
    do {
        const params = {
            ApplicationId: projectId,
            PageSize: PAGE_SIZE.toString(),
            Token: token
        };
        const data = await pinpoint.send(new GetCampaignsCommand(params));
        const deletedSegments = new Set();
        for (const campaign of data.CampaignsResponse.Item.filter(
            value => [CampaignStatus.DELETED, CampaignStatus.COMPLETED].includes(
                value.State.CampaignStatus) && value.Schedule && value.Schedule.Frequency === Frequency.ONCE && DateTime.fromISO(
                value.Schedule.StartTime) < deletionThreshold)) {
            if (!deletedSegments.has(campaign.SegmentId)) {
                try {
                    await pinpoint.send(
                        new DeleteSegmentCommand({ApplicationId: projectId, SegmentId: campaign.SegmentId}));
                    console.log('Deleted segment:', campaign.SegmentId);
                    deletedSegments.add(campaign.SegmentId);
                } catch (e) {
                    console.error(e, e.stack);
                }
            }
            try {
                await pinpoint.send(new DeleteCampaignCommand({ApplicationId: projectId, CampaignId: campaign.Id}));
                console.log('Deleted campaign:', campaign.Name);
            } catch (e) {
                console.error(e, e.stack);
            }
        }
        token = data.CampaignsResponse.NextToken;
    } while (token);
}