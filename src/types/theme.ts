export type ThemeId = 
  | 'gemini'
  | 'stripe'
  | 'nordic' 
  | 'dark-ops' 
  | 'swiss' 
  | 'titanium' 
  | 'terminal' 
  | 'warm-linen';

export interface ThemeOption {
  id: ThemeId;
  name: string;
  subtitle: string;
  description: string;
  category: 'light' | 'dark';
  swatches: [string, string, string]; // [bg, surface, accent]
  tag: string;
}

export const THEME_OPTIONS: ThemeOption[] = [
  {
    id: 'gemini',
    name: 'Gemini Soft',
    subtitle: 'Blue–White Airy',
    description: 'Soft blue–white gradients, pill inputs, minimal chrome, Google Blue accent. Light airy surfaces; dark near-black.',
    category: 'light',
    swatches: ['#e8f0fe', '#ffffff', '#1a73e8'],
    tag: 'Gemini / Stripe',
  },
  {
    id: 'stripe',
    name: 'Stripe SaaS',
    subtitle: 'Blurple & Deep Navy',
    description: 'Iconic Stripe design system with #635BFF blurple, #0A2540 navy, and #F6F9FC canvas.',
    category: 'light',
    swatches: ['#f6f9fc', '#ffffff', '#635bff'],
    tag: 'Stripe Official',
  },
  {
    id: 'nordic',
    name: 'Nordic Slate',
    subtitle: 'Linear Minimal',
    description: 'Crisp cool-white canvas, obsidian sidebar, and refined monospace data badges.',
    category: 'light',
    swatches: ['#f8fafc', '#ffffff', '#020617'],
    tag: 'SaaS Minimal',
  },
  {
    id: 'dark-ops',
    name: 'Dark Ops',
    subtitle: 'Mission Control',
    description: 'Deep obsidian plant floor mode with high-contrast emerald & amber telemetry.',
    category: 'dark',
    swatches: ['#09090b', '#18181b', '#10b981'],
    tag: 'Shop Floor',
  },
  {
    id: 'swiss',
    name: 'Swiss Precision',
    subtitle: 'Cobalt Modernist',
    description: 'Stark white surfaces, structured graphite grid lines, and bold cobalt accents.',
    category: 'light',
    swatches: ['#ffffff', '#f4f4f5', '#2563eb'],
    tag: 'Architectural',
  },
  {
    id: 'titanium',
    name: 'Titanium Steel',
    subtitle: 'SCADA Industrial',
    description: 'Metallic slate-blue and deep navy surfaces tailored for heavy manufacturing.',
    category: 'dark',
    swatches: ['#0f172a', '#1e293b', '#38bdf8'],
    tag: 'Industrial SCADA',
  },
  {
    id: 'terminal',
    name: 'Terminal Amber',
    subtitle: 'Phosphor Console',
    description: 'True OLED black canvas with warm golden-amber phosphor and monospace focus.',
    category: 'dark',
    swatches: ['#000000', '#121212', '#f59e0b'],
    tag: 'Retro Phosphor',
  },
  {
    id: 'warm-linen',
    name: 'Warm Linen',
    subtitle: 'Executive Papercraft',
    description: 'Soft sand and warm linen canvas, espresso typography, and bronze accents.',
    category: 'light',
    swatches: ['#f7f5f0', '#ffffff', '#b45309'],
    tag: 'Papercraft',
  },
];
