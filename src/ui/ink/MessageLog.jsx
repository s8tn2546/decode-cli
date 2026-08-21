import React from 'react';
import { Static, Text } from 'ink';

export default function MessageLog({ messages }) {
  if (!messages.length) return null;

  return (
    <Static items={messages}>
      {(line, i) => (
        // eslint-disable-next-line react/no-array-index-key
        <Text key={i}>{line}</Text>
      )}
    </Static>
  );
}
