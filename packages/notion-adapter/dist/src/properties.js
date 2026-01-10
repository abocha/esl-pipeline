import { ValidationError } from '@esl-pipeline/contracts';
export function buildBaseProperties(title, fm) {
    const properties = {
        Name: { title: [{ type: 'text', text: { content: title } }] },
    };
    if (fm.properties) {
        for (const [key, value] of Object.entries(fm.properties)) {
            if (value === null || value === undefined || value === '')
                continue;
            if (key.trim().toLowerCase() === 'topic')
                continue;
            if (key === 'Status') {
                properties[key] = { status: { name: String(value) } };
            }
            else if (key === 'Audio' || String(value).startsWith('http')) {
                properties[key] = { url: String(value) };
            }
            else {
                properties[key] = { rich_text: [{ type: 'text', text: { content: String(value) } }] };
            }
        }
    }
    return properties;
}
export function assertKnownProperties(properties, databaseProperties) {
    if (!databaseProperties)
        return;
    const propertiesEntries = Object.entries(databaseProperties);
    const dbPropertyNames = new Set(propertiesEntries.map(([name]) => name.trim().toLowerCase()));
    const unknownProps = Object.keys(properties)
        .filter((key) => key.toLowerCase() !== 'name')
        .filter((key) => !dbPropertyNames.has(key.trim().toLowerCase()));
    if (unknownProps.length === 0)
        return;
    const available = [...dbPropertyNames].join(', ') || '(none)';
    throw new ValidationError(`Unknown Notion properties in frontmatter: ${unknownProps.join(', ')}. Available properties: ${available}`);
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