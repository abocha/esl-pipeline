import { ValidationError } from '@esl-pipeline/contracts';
const GENERATED_PROPERTY_TYPES = new Set([
    'rollup',
    'created_time',
    'created_by',
    'last_edited_time',
    'last_edited_by',
]);
const normalizeKey = (value) => value.trim().toLowerCase();
const isBlank = (value) => value === null || value === undefined || value === '';
const createTextItem = (content) => ({
    type: 'text',
    text: { content },
});
const normalizeString = (value, name) => {
    if (typeof value === 'string')
        return value;
    if (typeof value === 'number' || typeof value === 'boolean')
        return String(value);
    throw new ValidationError(`Property "${name}" must be a string.`);
};
const normalizeStringArray = (value, name) => {
    if (Array.isArray(value)) {
        return value.map((entry) => normalizeString(entry, name)).map((entry) => entry.trim()).filter(Boolean);
    }
    if (typeof value === 'string') {
        return value
            .split(',')
            .map((entry) => entry.trim())
            .filter(Boolean);
    }
    throw new ValidationError(`Property "${name}" must be a string or string array.`);
};
const normalizeBoolean = (value, name) => {
    if (typeof value === 'boolean')
        return value;
    if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        if (normalized === 'true')
            return true;
        if (normalized === 'false')
            return false;
    }
    throw new ValidationError(`Property "${name}" must be a boolean.`);
};
const normalizeNumber = (value, name) => {
    if (typeof value === 'number' && Number.isFinite(value))
        return value;
    if (typeof value === 'string' && value.trim() !== '') {
        const parsed = Number(value);
        if (Number.isFinite(parsed))
            return parsed;
    }
    throw new ValidationError(`Property "${name}" must be a number.`);
};
const normalizeSelect = (value, name) => {
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        return String(value).trim();
    }
    if (value && typeof value === 'object' && 'name' in value) {
        const label = value.name;
        if (typeof label === 'string' && label.trim())
            return label.trim();
    }
    throw new ValidationError(`Property "${name}" must be a select name string.`);
};
const normalizeDate = (value, name) => {
    if (typeof value === 'string')
        return { start: value };
    if (value && typeof value === 'object') {
        const { start, end, time_zone } = value;
        if (typeof start !== 'string' || start.trim().length === 0) {
            throw new ValidationError(`Property "${name}" must include a date start string.`);
        }
        const datePayload = { start };
        if (typeof end === 'string' && end.trim())
            datePayload.end = end;
        if (typeof time_zone === 'string' && time_zone.trim())
            datePayload.time_zone = time_zone;
        return datePayload;
    }
    throw new ValidationError(`Property "${name}" must be a date string or object.`);
};
const normalizeIdList = (value, name) => {
    const toId = (entry) => {
        if (typeof entry === 'string')
            return { id: entry };
        if (entry && typeof entry === 'object' && 'id' in entry) {
            const idValue = entry.id;
            if (typeof idValue === 'string')
                return { id: idValue };
        }
        throw new ValidationError(`Property "${name}" must contain Notion IDs.`);
    };
    if (Array.isArray(value))
        return value.map((entry) => toId(entry));
    return [toId(value)];
};
const guessFileName = (url) => {
    const trimmed = url.trim();
    const parts = trimmed.split('/').filter(Boolean);
    return parts.at(-1) ?? 'file';
};
const normalizeFiles = (value, name) => {
    const toFile = (entry) => {
        if (typeof entry === 'string') {
            return { name: guessFileName(entry), type: 'external', external: { url: entry } };
        }
        if (entry && typeof entry === 'object' && 'url' in entry) {
            const urlValue = entry.url;
            if (typeof urlValue !== 'string' || urlValue.trim().length === 0) {
                throw new ValidationError(`Property "${name}" file entries must include a url string.`);
            }
            const nameValue = entry.name;
            const entryName = typeof nameValue === 'string' && nameValue.trim().length > 0
                ? nameValue
                : guessFileName(urlValue);
            return { name: entryName, type: 'external', external: { url: urlValue } };
        }
        throw new ValidationError(`Property "${name}" must be a URL or file descriptor.`);
    };
    if (Array.isArray(value))
        return value.map((entry) => toFile(entry));
    return [toFile(value)];
};
const getPropertyType = (value) => {
    if (!value || typeof value !== 'object')
        return undefined;
    if (!('type' in value))
        return undefined;
    const typeValue = value.type;
    return typeof typeValue === 'string' ? typeValue : undefined;
};
const buildPropertyIndex = (databaseProperties) => {
    const index = new Map();
    for (const [name, property] of Object.entries(databaseProperties)) {
        const type = getPropertyType(property);
        if (!type)
            continue;
        index.set(normalizeKey(name), { name, type });
    }
    return index;
};
export function buildBaseProperties(title, fm) {
    const properties = {
        Name: { title: [createTextItem(title)] },
    };
    if (fm.properties) {
        for (const [key, value] of Object.entries(fm.properties)) {
            if (isBlank(value))
                continue;
            if (normalizeKey(key) === 'topic')
                continue;
            if (key === 'Status') {
                properties[key] = { status: { name: String(value) } };
            }
            else if (key === 'Audio' || String(value).startsWith('http')) {
                properties[key] = { url: String(value) };
            }
            else {
                properties[key] = { rich_text: [createTextItem(String(value))] };
            }
        }
    }
    return properties;
}
export function assertKnownProperties(properties, databaseProperties) {
    if (!databaseProperties)
        return;
    const propertiesEntries = Object.entries(databaseProperties);
    const dbPropertyNames = new Set(propertiesEntries.map(([name]) => normalizeKey(name)));
    const unknownProps = Object.keys(properties)
        .filter((key) => normalizeKey(key) !== 'name')
        .filter((key) => !dbPropertyNames.has(normalizeKey(key)));
    if (unknownProps.length === 0)
        return;
    const available = [...dbPropertyNames].join(', ') || '(none)';
    throw new ValidationError(`Unknown Notion properties in frontmatter: ${unknownProps.join(', ')}. Available properties: ${available}`);
}
export function findTitlePropertyName(databaseProperties, fallback = 'Name') {
    if (!databaseProperties)
        return fallback;
    for (const [name, property] of Object.entries(databaseProperties)) {
        if (getPropertyType(property) === 'title') {
            return name;
        }
    }
    return fallback;
}
export function buildTitleProperty(title, titlePropertyName) {
    return {
        [titlePropertyName]: { title: [createTextItem(title)] },
    };
}
export function mapFrontmatterProperties(fmProperties, databaseProperties, options = {}) {
    if (!fmProperties)
        return {};
    if (!databaseProperties)
        return {};
    const skip = new Set((options.skipKeys ?? []).map((key) => normalizeKey(key)));
    const propertyIndex = buildPropertyIndex(databaseProperties);
    const mapped = {};
    for (const [rawKey, rawValue] of Object.entries(fmProperties)) {
        if (isBlank(rawValue))
            continue;
        const key = normalizeKey(rawKey);
        if (skip.has(key))
            continue;
        const meta = propertyIndex.get(key);
        if (!meta) {
            const available = [...propertyIndex.values()].map((entry) => entry.name).join(', ') || '(none)';
            throw new ValidationError(`Unknown Notion properties in frontmatter: ${rawKey}. Available properties: ${available}`);
        }
        if (GENERATED_PROPERTY_TYPES.has(meta.type)) {
            throw new ValidationError(`Property "${meta.name}" is Notion-generated (${meta.type}) and cannot be set manually.`);
        }
        mapped[meta.name] = mapPropertyValue(meta.type, rawValue, meta.name);
    }
    return mapped;
}
function mapPropertyValue(type, value, name) {
    switch (type) {
        case 'title': {
            return { title: [createTextItem(normalizeString(value, name))] };
        }
        case 'rich_text': {
            return { rich_text: [createTextItem(normalizeString(value, name))] };
        }
        case 'number': {
            return { number: normalizeNumber(value, name) };
        }
        case 'select': {
            return { select: { name: normalizeSelect(value, name) } };
        }
        case 'multi_select': {
            return {
                multi_select: normalizeStringArray(value, name).map((entry) => ({ name: entry })),
            };
        }
        case 'status': {
            return { status: { name: normalizeSelect(value, name) } };
        }
        case 'date': {
            return { date: normalizeDate(value, name) };
        }
        case 'people': {
            return { people: normalizeIdList(value, name) };
        }
        case 'files': {
            return { files: normalizeFiles(value, name) };
        }
        case 'checkbox': {
            return { checkbox: normalizeBoolean(value, name) };
        }
        case 'url': {
            return { url: normalizeString(value, name) };
        }
        case 'email': {
            return { email: normalizeString(value, name) };
        }
        case 'phone_number': {
            return { phone_number: normalizeString(value, name) };
        }
        case 'relation': {
            return { relation: normalizeIdList(value, name) };
        }
        default: {
            throw new ValidationError(`Property "${name}" has unsupported Notion type "${type}".`);
        }
    }
}
export function getTopicPropertyType(databaseProperties) {
    if (!databaseProperties)
        return undefined;
    const topicEntry = Object.entries(databaseProperties).find(([name]) => name.trim().toLowerCase() === 'topic');
    const topicProp = topicEntry?.[1];
    if (topicProp && typeof topicProp === 'object' && 'type' in topicProp) {
        const type = topicProp.type;
        return typeof type === 'string' ? type : undefined;
    }
    return undefined;
}
export function applyTopicProperty(properties, topic, topicPropType) {
    if (!topic)
        return;
    const defaultToMultiSelect = !topicPropType || topicPropType === 'multi_select';
    if (defaultToMultiSelect) {
        const topics = topic
            .split(',')
            .map((item) => item.trim())
            .filter(Boolean)
            .map((name) => ({ name }));
        properties['Topic'] = { multi_select: topics };
    }
    else {
        properties['Topic'] = { rich_text: [{ type: 'text', text: { content: topic } }] };
    }
}
//# sourceMappingURL=properties.js.map