import {DateTime} from "luxon";
import crypto from "crypto";

export function parseDateTime(str) {
    const [month, day, hour, minute] = str.match(/\d+/g);
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

export function zenkaku2hankaku(str) {
    return str.replace(/[Ａ-Ｚａ-ｚ０-９]/g, s => String.fromCharCode(s.charCodeAt(0) - 0xFEE0));
}