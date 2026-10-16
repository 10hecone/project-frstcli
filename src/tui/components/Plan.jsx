import { Box, Text } from "ink";

/** Plan numéroté : titre en gras, puis « 1. étape » en grisé. */
export function Plan({ items }) {
    const list = Array.isArray(items) ? items : [];
    return (
        <Box flexDirection="column" marginTop={1}>
            <Text bold>Plan</Text>
            {list.map((item, index) => (
                <Text key={index}>
                    <Text color="gray">{`  ${index + 1}.`}</Text>
                    <Text dimColor>{` ${String(item ?? "")}`}</Text>
                </Text>
            ))}
        </Box>
    );
}

export default Plan;
