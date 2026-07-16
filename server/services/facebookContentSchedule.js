const DEFAULT_TIMEZONE = 'Africa/Tripoli';
const DEFAULT_DAYS = Object.freeze([0, 1, 2, 3, 4, 5, 6]);
const DEFAULT_TIMES = Object.freeze(['09:00']);
const MAX_LOOKAHEAD_DAYS = 16;

const uniqueSorted = values => [...new Set(values)].sort((left, right) => (
    typeof left === 'number' ? left - right : String(left).localeCompare(String(right))
));

export const isValidTimeZone = value => {
    try {
        new Intl.DateTimeFormat('en-US', { timeZone: String(value || '') }).format(new Date());
        return true;
    } catch {
        return false;
    }
};

export const normalizeTimeZone = value => (
    isValidTimeZone(value) ? String(value) : DEFAULT_TIMEZONE
);

export const normalizeScheduleDays = value => {
    const rows = Array.isArray(value) ? value : [];
    const normalized = rows
        .map(day => Number(day))
        .filter(day => Number.isInteger(day) && day >= 0 && day <= 6);
    return normalized.length ? uniqueSorted(normalized) : [...DEFAULT_DAYS];
};

export const normalizeScheduleTimes = value => {
    const rows = Array.isArray(value) ? value : [];
    const normalized = rows
        .map(time => String(time || '').trim())
        .filter(time => /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time));
    return normalized.length ? uniqueSorted(normalized) : [...DEFAULT_TIMES];
};

export const parseStoredList = (value, fallback = []) => {
    if (Array.isArray(value)) return value;
    if (!value) return fallback;
    try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed : fallback;
    } catch {
        return fallback;
    }
};

const zonedDateTimeParts = (date, timeZone = DEFAULT_TIMEZONE) => {
    const formatter = new Intl.DateTimeFormat('en-GB', {
        timeZone: normalizeTimeZone(timeZone),
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        weekday: 'short',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
    });
    const parts = formatter.formatToParts(date).reduce((result, part) => {
        result[part.type] = part.value;
        return result;
    }, {});
    const weekdays = {
        Sun: 0,
        Mon: 1,
        Tue: 2,
        Wed: 3,
        Thu: 4,
        Fri: 5,
        Sat: 6,
    };
    return {
        year: Number(parts.year),
        month: Number(parts.month),
        date: Number(parts.day),
        day: weekdays[parts.weekday],
        hour: Number(parts.hour),
        minute: Number(parts.minute),
        time: `${parts.hour}:${parts.minute}`,
    };
};

export const zonedMinuteParts = (date, timeZone = DEFAULT_TIMEZONE) => {
    const parts = zonedDateTimeParts(date, timeZone);
    return { day: parts.day, time: parts.time };
};

export const localDateTimeToUtc = ({ year, month, date, hour, minute, timeZone }) => {
    const targetTimestamp = Date.UTC(year, month - 1, date, hour, minute);
    let candidateTimestamp = targetTimestamp;

    for (let attempt = 0; attempt < 4; attempt += 1) {
        const observed = zonedDateTimeParts(new Date(candidateTimestamp), timeZone);
        const observedTimestamp = Date.UTC(
            observed.year,
            observed.month - 1,
            observed.date,
            observed.hour,
            observed.minute,
        );
        const difference = observedTimestamp - targetTimestamp;
        if (difference === 0) break;
        candidateTimestamp -= difference;
    }

    const candidate = new Date(candidateTimestamp);
    const verified = zonedDateTimeParts(candidate, timeZone);
    if (
        verified.year !== year
        || verified.month !== month
        || verified.date !== date
        || verified.hour !== hour
        || verified.minute !== minute
    ) {
        return null;
    }
    return candidate;
};

export const zonedDayBounds = (date = new Date(), timeZone = DEFAULT_TIMEZONE) => {
    const origin = date instanceof Date ? date : new Date(date);
    if (Number.isNaN(origin.getTime())) throw new TypeError('date must be valid');
    const normalizedTimeZone = normalizeTimeZone(timeZone);
    const local = zonedDateTimeParts(origin, normalizedTimeZone);
    const start = localDateTimeToUtc({
        year: local.year,
        month: local.month,
        date: local.date,
        hour: 0,
        minute: 0,
        timeZone: normalizedTimeZone,
    });
    const nextLocalDate = new Date(Date.UTC(local.year, local.month - 1, local.date + 1));
    const end = localDateTimeToUtc({
        year: nextLocalDate.getUTCFullYear(),
        month: nextLocalDate.getUTCMonth() + 1,
        date: nextLocalDate.getUTCDate(),
        hour: 0,
        minute: 0,
        timeZone: normalizedTimeZone,
    });
    if (!start || !end) throw new Error('Unable to calculate timezone day bounds');
    return { start, end };
};

export const nextCampaignRun = ({
    from = new Date(),
    timeZone = DEFAULT_TIMEZONE,
    days = DEFAULT_DAYS,
    times = DEFAULT_TIMES,
} = {}) => {
    const origin = from instanceof Date ? from : new Date(from);
    if (Number.isNaN(origin.getTime())) throw new TypeError('from must be a valid date');
    const allowedDays = new Set(normalizeScheduleDays(days));
    const allowedTimes = normalizeScheduleTimes(times);
    const normalizedTimeZone = normalizeTimeZone(timeZone);
    const localOrigin = zonedDateTimeParts(origin, normalizedTimeZone);

    for (let dayOffset = 0; dayOffset < MAX_LOOKAHEAD_DAYS; dayOffset += 1) {
        const localDate = new Date(Date.UTC(
            localOrigin.year,
            localOrigin.month - 1,
            localOrigin.date + dayOffset,
        ));
        const year = localDate.getUTCFullYear();
        const month = localDate.getUTCMonth() + 1;
        const date = localDate.getUTCDate();
        const day = localDate.getUTCDay();
        if (!allowedDays.has(day)) continue;

        for (const time of allowedTimes) {
            const [hour, minute] = time.split(':').map(Number);
            const candidate = localDateTimeToUtc({
                year,
                month,
                date,
                hour,
                minute,
                timeZone: normalizedTimeZone,
            });
            if (candidate && candidate.getTime() > origin.getTime()) return candidate;
        }
    }

    throw new Error('Unable to find the next campaign run within the scheduling window');
};

export const isWithinPostingWindow = ({
    date = new Date(),
    timeZone = DEFAULT_TIMEZONE,
    days = DEFAULT_DAYS,
    startTime = '08:00',
    endTime = '22:00',
} = {}) => {
    const parts = zonedMinuteParts(date instanceof Date ? date : new Date(date), timeZone);
    if (!normalizeScheduleDays(days).includes(parts.day)) return false;
    const normalizedStart = normalizeScheduleTimes([startTime])[0];
    const normalizedEnd = normalizeScheduleTimes([endTime])[0];
    if (normalizedStart <= normalizedEnd) {
        return parts.time >= normalizedStart && parts.time <= normalizedEnd;
    }
    return parts.time >= normalizedStart || parts.time <= normalizedEnd;
};
