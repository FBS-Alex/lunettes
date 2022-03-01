import {DateTime} from "luxon";
import crypto from "crypto";

export function parseDateTime(str) {
    const match = str.match(/(\d+)[月/](\d+)日?（.）(\d+):(\d+)～/);
    const [, month, day, hour, minute] = match;
    const now = DateTime.local();
    let year = now.year;
    if (month < now.month || (month === now.month && day < now.day)) {
        year++;
    }
    return DateTime.local(year, +month, +day, +hour, +minute);
}

export function createHash(input) {
    return crypto.createHash('sha256', {outputLength: 32}).update(input).digest('hex');
}