export function generateId(): string {
  return Math.random().toString(36).substring(2, 15) +
    Math.random().toString(36).substring(2, 15);
}

export function generateInviteCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

export function formatAge(birthDate: number | null): string {
  if (!birthDate) return "";
  const now = Date.now();
  const diffMs = now - birthDate;
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return "Day 1";
  if (diffDays === 1) return "Day 2";
  if (diffDays < 7) return `Day ${diffDays + 1}`;
  if (diffDays < 14) return "1 week";
  if (diffDays < 21) return "2 weeks";
  if (diffDays < 28) return "3 weeks";
  if (diffDays < 60) return `${Math.floor(diffDays / 7)} weeks`;
  if (diffDays < 90) return `${Math.floor(diffDays / 30)} month`;
  return `${Math.floor(diffDays / 30)} months`;
}

export function timeSince(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;
  const minutes = Math.floor(diff / (1000 * 60));
  const hours = Math.floor(diff / (1000 * 60 * 60));

  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString("en-SG", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString("en-SG", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

export function formatMl(value: number): string {
  return `${value} ml`;
}

export function formatWeight(value: number): string {
  if (value >= 1000) {
    return `${(value / 1000).toFixed(2)} kg`;
  }
  return `${value} g`;
}

export function formatLength(value: number): string {
  if (value >= 10) {
    return `${(value / 10).toFixed(1)} cm`;
  }
  return `${value} mm`;
}
