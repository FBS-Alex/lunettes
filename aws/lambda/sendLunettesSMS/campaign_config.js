import {DateTime} from 'luxon';

export class CampaignConfig {
    constructor(template, nameSuffix, dateTime) {
        this.template = template;
        this.nameSuffix = nameSuffix;
        this.calculateDateTime = dateTime;
    }

    isApplicable(dateTime) {
        return this.calculateDateTime(dateTime) > DateTime.local();
    }
}