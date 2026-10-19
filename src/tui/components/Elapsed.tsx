import { useEffect, useState } from 'react';
import { Text } from 'ink';

export function Elapsed({ since }: { since: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, []);
  return <Text dimColor>{((now - since) / 1000).toFixed(1)}s</Text>;
}
