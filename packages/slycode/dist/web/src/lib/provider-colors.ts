export const providerColors: Record<string, { color: string; bg: string; border: string; dot: string }> = {
  claude: {
    color: '#d4764e',
    bg: 'rgba(212, 118, 78, 0.15)',
    border: 'rgba(212, 118, 78, 0.4)',
    dot: '#d4764e',
  },
  codex: {
    color: '#6b8fae',
    bg: 'rgba(107, 143, 174, 0.15)',
    border: 'rgba(107, 143, 174, 0.4)',
    dot: '#6b8fae',
  },
  gemini: {
    color: '#8b7ec8',
    bg: 'rgba(139, 126, 200, 0.15)',
    border: 'rgba(139, 126, 200, 0.4)',
    dot: '#8b7ec8',
  },
};

const defaultProviderColor = {
  color: '#00bfff',
  bg: 'rgba(0, 191, 255, 0.15)',
  border: 'rgba(0, 191, 255, 0.4)',
  dot: '#00bfff',
};

export function getProviderColor(providerId: string) {
  return providerColors[providerId] || defaultProviderColor;
}
