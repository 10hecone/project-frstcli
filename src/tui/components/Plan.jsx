import { Box, Text } from "ink";

/** Plan numéroté : titre en gras, puis « 1. étape » en grisé. */
export function Plan({ items, color = true }) {
    const list = Array.isArray(items) ? items : [];
    return (
        <Box flexDirection="column" marginTop={1}>
            <Text bold={color}>Plan</Text>
            {list.map((item, index) => (
                <Text key={index}>
                    <Text color={color ? "gray" : undefined}>{`  ${index + 1}.`}</Text>
                    <Text dimColor={color}>{` ${String(item ?? "")}`}</Text>
                </Text>
            ))}
        </Box>
    );
}

export default Plan;
