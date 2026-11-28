import React from "react";

export const ChartGradient: React.FC<{
  id: string;
  color: string;
  topOpacity?: number;
}> = ({ id, color, topOpacity = 0.28 }) => (
  <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
    <stop offset="0%" stopColor={color} stopOpacity={topOpacity} />
    <stop offset="96%" stopColor={color} stopOpacity={0} />
  </linearGradient>
);
