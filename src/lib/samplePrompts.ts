import {
  Task1ChartType,
  Task1TopicBankItem,
  WritingTaskType,
} from '../types/ielts';

export interface MasterWritingPrompt {
  id: string;
  taskType: WritingTaskType;
  topicTag: string;
  prompt: string;
}

export const TASK1_CHART_TYPE_ENGLISH: Record<Task1ChartType, string> = {
  折线图: 'LINE GRAPH',
  柱状图: 'BAR CHART',
  饼图: 'PIE CHART',
  表格: 'TABLE',
  地图: 'MAP',
  流程图: 'PROCESS DIAGRAM',
};

const VALID_TASK1_CHART_TYPES: Task1ChartType[] = [
  '折线图',
  '柱状图',
  '饼图',
  '表格',
  '地图',
  '流程图',
];

/**
 * Infers the canonical Task 1 chart category from AI output, prompt text, or essay text.
 */
export function inferTask1ChartType(
  prompt: string,
  essay = '',
  rawChartType?: string
): Task1ChartType {
  const cleanedRaw = (rawChartType || '').trim();
  if (VALID_TASK1_CHART_TYPES.includes(cleanedRaw as Task1ChartType)) {
    return cleanedRaw as Task1ChartType;
  }
  if (cleanedRaw.includes('折线') || /line/i.test(cleanedRaw)) return '折线图';
  if (cleanedRaw.includes('柱状') || /bar/i.test(cleanedRaw)) return '柱状图';
  if (cleanedRaw.includes('饼') || /pie/i.test(cleanedRaw)) return '饼图';
  if (cleanedRaw.includes('表格') || /table/i.test(cleanedRaw)) return '表格';
  if (cleanedRaw.includes('地图') || /map/i.test(cleanedRaw)) return '地图';
  if (cleanedRaw.includes('流程') || /process|diagram/i.test(cleanedRaw)) {
    return '流程图';
  }

  const combined = `${prompt} ${essay}`.toLowerCase();
  if (
    /\b(map|maps|layout|town|island|redevelop|redeveloped|floor plan|village|coastal)\b|地图/.test(
      combined
    )
  ) {
    return '地图';
  }
  if (
    /\b(process|stage|stages|step|steps|how .* is made|how .* are made|lifecycle|life cycle|recycl|manufactur|produce|production|flow chart|flowchart)\b|流程图|流程/.test(
      combined
    )
  ) {
    return '流程图';
  }
  if (/\b(pie|pies|pie chart|pie charts)\b|饼图|扇形图/.test(combined)) {
    return '饼图';
  }
  if (/\b(table|tables)\b|表格/.test(combined)) {
    return '表格';
  }
  if (
    /\b(bar|bars|bar chart|bar charts|bar graph)\b|柱状图|条形图/.test(combined)
  ) {
    return '柱状图';
  }
  if (
    /\b(line|lines|line graph|line chart|graph)\b|折线图|曲线图/.test(combined)
  ) {
    return '折线图';
  }
  if (/\b(diagram)\b/.test(combined)) {
    return '流程图';
  }
  if (/\b(chart)\b/.test(combined)) {
    return '柱状图';
  }
  return '折线图';
}

function svgToDataUrl(svgString: string): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(svgString.trim())}`;
}

const SVG_LINE_GRAPH = svgToDataUrl(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 360" width="640" height="360">
  <rect width="640" height="360" fill="#FAF8F5"/>
  <text x="320" y="30" text-anchor="middle" font-family="Georgia, serif" font-size="14" font-weight="bold" fill="#262523">Renewable Electricity Generation by Country (1990–2025)</text>
  <g stroke="#E2DFD5" stroke-width="1">
    <line x1="70" y1="60" x2="590" y2="60"/>
    <line x1="70" y1="105" x2="590" y2="105"/>
    <line x1="70" y1="150" x2="590" y2="150"/>
    <line x1="70" y1="195" x2="590" y2="195"/>
    <line x1="70" y1="240" x2="590" y2="240"/>
    <line x1="70" y1="285" x2="590" y2="285" stroke="#8C867E" stroke-width="1.5"/>
    <line x1="70" y1="60" x2="70" y2="285" stroke="#8C867E" stroke-width="1.5"/>
  </g>
  <g font-family="monospace" font-size="11" fill="#7A7873" text-anchor="end">
    <text x="60" y="64">75%</text>
    <text x="60" y="109">60%</text>
    <text x="60" y="154">45%</text>
    <text x="60" y="199">30%</text>
    <text x="60" y="244">15%</text>
    <text x="60" y="289">0%</text>
  </g>
  <g font-family="monospace" font-size="11" fill="#262523" text-anchor="middle">
    <text x="80" y="306">1990</text>
    <text x="180" y="306">2000</text>
    <text x="280" y="306">2010</text>
    <text x="430" y="306">2020</text>
    <text x="570" y="306">2025</text>
  </g>
  <polyline fill="none" stroke="#EA5B25" stroke-width="2.6" points="80,145 180,130 280,112 430,86 570,69"/>
  <g fill="#EA5B25">
    <circle cx="80" cy="145" r="3.5"/><circle cx="180" cy="130" r="3.5"/><circle cx="280" cy="112" r="3.5"/><circle cx="430" cy="86" r="3.5"/><circle cx="570" cy="69" r="3.5"/>
  </g>
  <polyline fill="none" stroke="#262523" stroke-width="2.4" points="80,273 180,264 280,234 430,150 570,118"/>
  <g fill="#262523">
    <circle cx="80" cy="273" r="3.5"/><circle cx="180" cy="264" r="3.5"/><circle cx="280" cy="234" r="3.5"/><circle cx="430" cy="150" r="3.5"/><circle cx="570" cy="118" r="3.5"/>
  </g>
  <polyline fill="none" stroke="#2E7D5B" stroke-width="2.2" stroke-dasharray="5,3" points="80,279 180,276 280,261 430,165 570,142"/>
  <g fill="#2E7D5B">
    <circle cx="80" cy="279" r="3.2"/><circle cx="180" cy="276" r="3.2"/><circle cx="280" cy="261" r="3.2"/><circle cx="430" cy="165" r="3.2"/><circle cx="570" cy="142" r="3.2"/>
  </g>
  <polyline fill="none" stroke="#8C7A5B" stroke-width="2" points="80,255 180,258 280,252 430,213 570,183"/>
  <g fill="#8C7A5B">
    <circle cx="80" cy="255" r="3.2"/><circle cx="180" cy="258" r="3.2"/><circle cx="280" cy="252" r="3.2"/><circle cx="430" cy="213" r="3.2"/><circle cx="570" cy="183" r="3.2"/>
  </g>
  <g font-family="sans-serif" font-size="11" fill="#262523">
    <line x1="115" y1="336" x2="138" y2="336" stroke="#EA5B25" stroke-width="2.6"/><text x="144" y="340">Sweden</text>
    <line x1="225" y1="336" x2="248" y2="336" stroke="#262523" stroke-width="2.4"/><text x="254" y="340">Germany</text>
    <line x1="345" y1="336" x2="368" y2="336" stroke="#2E7D5B" stroke-width="2.2" stroke-dasharray="4,2"/><text x="374" y="340">UK</text>
    <line x1="435" y1="336" x2="458" y2="336" stroke="#8C7A5B" stroke-width="2"/><text x="464" y="340">Australia</text>
  </g>
</svg>
`);

const SVG_BAR_CHART = svgToDataUrl(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 360" width="640" height="360">
  <rect width="640" height="360" fill="#FAF8F5"/>
  <text x="320" y="30" text-anchor="middle" font-family="Georgia, serif" font-size="14" font-weight="bold" fill="#262523">Household Income Expenditure by Category &amp; Income Group (2024)</text>
  <g stroke="#E2DFD5" stroke-width="1">
    <line x1="70" y1="65" x2="590" y2="65"/>
    <line x1="70" y1="120" x2="590" y2="120"/>
    <line x1="70" y1="175" x2="590" y2="175"/>
    <line x1="70" y1="230" x2="590" y2="230"/>
    <line x1="70" y1="285" x2="590" y2="285" stroke="#8C867E" stroke-width="1.5"/>
    <line x1="70" y1="65" x2="70" y2="285" stroke="#8C867E" stroke-width="1.5"/>
  </g>
  <g font-family="monospace" font-size="11" fill="#7A7873" text-anchor="end">
    <text x="60" y="69">40%</text>
    <text x="60" y="124">30%</text>
    <text x="60" y="179">20%</text>
    <text x="60" y="234">10%</text>
    <text x="60" y="289">0%</text>
  </g>
  <rect x="95" y="92" width="18" height="193" fill="#EA5B25" rx="2"/>
  <rect x="116" y="131" width="18" height="154" fill="#262523" rx="2"/>
  <rect x="137" y="164" width="18" height="121" fill="#9E988E" rx="2"/>
  <rect x="195" y="136" width="18" height="149" fill="#EA5B25" rx="2"/>
  <rect x="216" y="180" width="18" height="105" fill="#262523" rx="2"/>
  <rect x="237" y="219" width="18" height="66" fill="#9E988E" rx="2"/>
  <rect x="295" y="219" width="18" height="66" fill="#EA5B25" rx="2"/>
  <rect x="316" y="191" width="18" height="94" fill="#262523" rx="2"/>
  <rect x="337" y="175" width="18" height="110" fill="#9E988E" rx="2"/>
  <rect x="395" y="235" width="18" height="50" fill="#EA5B25" rx="2"/>
  <rect x="416" y="224" width="18" height="61" fill="#262523" rx="2"/>
  <rect x="437" y="213" width="18" height="72" fill="#9E988E" rx="2"/>
  <rect x="495" y="246" width="18" height="39" fill="#EA5B25" rx="2"/>
  <rect x="516" y="197" width="18" height="88" fill="#262523" rx="2"/>
  <rect x="537" y="131" width="18" height="154" fill="#9E988E" rx="2"/>
  <g font-family="sans-serif" font-size="11" fill="#262523" text-anchor="middle">
    <text x="125" y="305">Housing</text>
    <text x="225" y="305">Food</text>
    <text x="325" y="305">Transport</text>
    <text x="425" y="305">Healthcare</text>
    <text x="525" y="305">Leisure</text>
  </g>
  <g font-family="sans-serif" font-size="11" fill="#262523">
    <rect x="145" y="328" width="12" height="12" fill="#EA5B25" rx="2"/><text x="163" y="338">Low Income</text>
    <rect x="265" y="328" width="12" height="12" fill="#262523" rx="2"/><text x="283" y="338">Middle Income</text>
    <rect x="400" y="328" width="12" height="12" fill="#9E988E" rx="2"/><text x="418" y="338">High Income</text>
  </g>
</svg>
`);

const SVG_PIE_CHART = svgToDataUrl(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 360" width="640" height="360">
  <rect width="640" height="360" fill="#FAF8F5"/>
  <text x="320" y="30" text-anchor="middle" font-family="Georgia, serif" font-size="14" font-weight="bold" fill="#262523">Energy Production by Fuel Source in France (1995 vs 2025)</text>
  <g transform="translate(185, 172)">
    <circle r="86" fill="#262523"/>
    <path d="M0,0 L0,-86 A86,86 0 0,1 81.8,26.6 Z" fill="#EA5B25"/>
    <path d="M0,0 L81.8,26.6 A86,86 0 0,1 -50.5,69.6 Z" fill="#2E7D5B"/>
    <path d="M0,0 L-50.5,69.6 A86,86 0 0,1 -81.8,-26.6 Z" fill="#8C7A5B"/>
    <circle r="28" fill="#FAF8F5"/>
    <text x="0" y="4" text-anchor="middle" font-family="monospace" font-size="12" font-weight="bold" fill="#262523">1995</text>
  </g>
  <g font-family="monospace" font-size="10" fill="#262523">
    <text x="235" y="112">Coal 29%</text>
    <text x="225" y="242">Gas 27%</text>
    <text x="68" y="218">Oil 24%</text>
    <text x="86" y="102">Nuclear 20%</text>
  </g>
  <g transform="translate(455, 172)">
    <circle r="86" fill="#262523"/>
    <path d="M0,0 L0,-86 A86,86 0 0,1 69.6,50.5 Z" fill="#2E7D5B"/>
    <path d="M0,0 L69.6,50.5 A86,86 0 0,1 -26.6,81.8 Z" fill="#EA5B25"/>
    <path d="M0,0 L-26.6,81.8 A86,86 0 0,1 -81.8,26.6 Z" fill="#8C7A5B"/>
    <circle r="28" fill="#FAF8F5"/>
    <text x="0" y="4" text-anchor="middle" font-family="monospace" font-size="12" font-weight="bold" fill="#262523">2025</text>
  </g>
  <g font-family="monospace" font-size="10" fill="#262523">
    <text x="515" y="122">Renewables 35%</text>
    <text x="485" y="255">Coal 13%</text>
    <text x="352" y="245">Oil 12%</text>
    <text x="342" y="105">Nuclear 40%</text>
  </g>
  <g font-family="sans-serif" font-size="11" fill="#262523">
    <rect x="115" y="324" width="12" height="12" fill="#262523" rx="2"/><text x="132" y="334">Nuclear</text>
    <rect x="215" y="324" width="12" height="12" fill="#2E7D5B" rx="2"/><text x="232" y="334">Renewables / Gas</text>
    <rect x="360" y="324" width="12" height="12" fill="#EA5B25" rx="2"/><text x="377" y="334">Coal</text>
    <rect x="440" y="324" width="12" height="12" fill="#8C7A5B" rx="2"/><text x="457" y="334">Oil &amp; Others</text>
  </g>
</svg>
`);

const SVG_TABLE_CHART = svgToDataUrl(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 360" width="640" height="360">
  <rect width="640" height="360" fill="#FAF8F5"/>
  <text x="320" y="32" text-anchor="middle" font-family="Georgia, serif" font-size="14" font-weight="bold" fill="#262523">Underground Railway Systems in Six Major Cities</text>
  <rect x="45" y="52" width="550" height="272" rx="6" fill="#FFFFFF" stroke="#D5D0C3" stroke-width="1.5"/>
  <rect x="45" y="52" width="550" height="40" rx="6" fill="#EFECE3"/>
  <line x1="45" y1="92" x2="595" y2="92" stroke="#D5D0C3" stroke-width="1.5"/>
  <line x1="45" y1="130" x2="595" y2="130" stroke="#EBE6DF"/>
  <line x1="45" y1="168" x2="595" y2="168" stroke="#EBE6DF"/>
  <line x1="45" y1="206" x2="595" y2="206" stroke="#EBE6DF"/>
  <line x1="45" y1="244" x2="595" y2="244" stroke="#EBE6DF"/>
  <line x1="45" y1="282" x2="595" y2="282" stroke="#EBE6DF"/>
  <line x1="185" y1="52" x2="185" y2="324" stroke="#EBE6DF"/>
  <line x1="315" y1="52" x2="315" y2="324" stroke="#EBE6DF"/>
  <line x1="455" y1="52" x2="455" y2="324" stroke="#EBE6DF"/>
  <g font-family="sans-serif" font-size="11" font-weight="bold" fill="#262523">
    <text x="65" y="76">City</text>
    <text x="250" y="76" text-anchor="middle">Date Opened</text>
    <text x="385" y="76" text-anchor="middle">Route (km)</text>
    <text x="525" y="76" text-anchor="middle">Passengers / Yr (M)</text>
  </g>
  <g font-family="monospace" font-size="12" fill="#262523">
    <text x="65" y="116" font-family="Georgia, serif" font-weight="bold">London</text><text x="250" y="116" text-anchor="middle">1863</text><text x="385" y="116" text-anchor="middle" fill="#EA5B25" font-weight="bold">394</text><text x="525" y="116" text-anchor="middle">775</text>
    <text x="65" y="154" font-family="Georgia, serif" font-weight="bold">Paris</text><text x="250" y="154" text-anchor="middle">1900</text><text x="385" y="154" text-anchor="middle">199</text><text x="525" y="154" text-anchor="middle">1,191</text>
    <text x="65" y="192" font-family="Georgia, serif" font-weight="bold">Tokyo</text><text x="250" y="192" text-anchor="middle">1927</text><text x="385" y="192" text-anchor="middle">155</text><text x="525" y="192" text-anchor="middle" fill="#EA5B25" font-weight="bold">1,927</text>
    <text x="65" y="230" font-family="Georgia, serif" font-weight="bold">Washington DC</text><text x="250" y="230" text-anchor="middle">1976</text><text x="385" y="230" text-anchor="middle">126</text><text x="525" y="230" text-anchor="middle">144</text>
    <text x="65" y="268" font-family="Georgia, serif" font-weight="bold">Kyoto</text><text x="250" y="268" text-anchor="middle">1981</text><text x="385" y="268" text-anchor="middle" fill="#2E7D5B" font-weight="bold">11</text><text x="525" y="268" text-anchor="middle" fill="#2E7D5B" font-weight="bold">45</text>
    <text x="65" y="306" font-family="Georgia, serif" font-weight="bold">Los Angeles</text><text x="250" y="306" text-anchor="middle">2001</text><text x="385" y="306" text-anchor="middle">28</text><text x="525" y="306" text-anchor="middle">50</text>
  </g>
</svg>
`);

const SVG_MAP_COMPARISON = svgToDataUrl(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 360" width="640" height="360">
  <rect width="640" height="360" fill="#FAF8F5"/>
  <text x="320" y="28" text-anchor="middle" font-family="Georgia, serif" font-size="14" font-weight="bold" fill="#262523">Redevelopment of Seaville (1995 vs 2025)</text>
  <rect x="30" y="45" width="275" height="285" rx="8" fill="#F2EFE7" stroke="#D5D0C3" stroke-width="1.5"/>
  <text x="167" y="68" text-anchor="middle" font-family="monospace" font-size="12" font-weight="bold" fill="#262523">SEAVILLE · 1995</text>
  <rect x="30" y="265" width="275" height="65" rx="4" fill="#DCE7EC"/>
  <text x="167" y="304" text-anchor="middle" font-family="Georgia, serif" font-style="italic" font-size="12" fill="#4A6B7C">South Sea &amp; Fishing Port</text>
  <rect x="50" y="90" width="105" height="68" rx="4" fill="#E3ECE4" stroke="#2E7D5B"/>
  <text x="102" y="128" text-anchor="middle" font-family="sans-serif" font-size="11" fill="#2E7D5B">Farmland</text>
  <rect x="175" y="90" width="110" height="68" rx="4" fill="#E3ECE4" stroke="#2E7D5B"/>
  <text x="230" y="128" text-anchor="middle" font-family="sans-serif" font-size="11" fill="#2E7D5B">Forest Park</text>
  <rect x="50" y="185" width="105" height="52" rx="4" fill="#FAF8F5" stroke="#8C867E"/>
  <text x="102" y="215" text-anchor="middle" font-family="sans-serif" font-size="11" fill="#262523">Small Shops</text>
  <rect x="175" y="185" width="110" height="52" rx="4" fill="#FAF8F5" stroke="#8C867E"/>
  <text x="230" y="215" text-anchor="middle" font-family="sans-serif" font-size="11" fill="#262523">Fish Market</text>
  <rect x="335" y="45" width="275" height="285" rx="8" fill="#F2EFE7" stroke="#D5D0C3" stroke-width="1.5"/>
  <text x="472" y="68" text-anchor="middle" font-family="monospace" font-size="12" font-weight="bold" fill="#EA5B25">SEAVILLE · 2025</text>
  <rect x="335" y="265" width="275" height="65" rx="4" fill="#DCE7EC"/>
  <text x="472" y="304" text-anchor="middle" font-family="Georgia, serif" font-style="italic" font-size="12" fill="#4A6B7C">Yacht Marina &amp; Pier</text>
  <rect x="355" y="90" width="235" height="68" rx="4" fill="#FAF0EC" stroke="#EA5B25" stroke-width="1.5"/>
  <text x="472" y="128" text-anchor="middle" font-family="sans-serif" font-size="11" font-weight="bold" fill="#EA5B25">18-Hole Golf Course &amp; Tennis Courts</text>
  <rect x="355" y="185" width="110" height="52" rx="4" fill="#FAF0EC" stroke="#EA5B25"/>
  <text x="410" y="215" text-anchor="middle" font-family="sans-serif" font-size="11" fill="#262523">Restaurants</text>
  <rect x="480" y="185" width="110" height="52" rx="4" fill="#FAF0EC" stroke="#EA5B25"/>
  <text x="535" y="215" text-anchor="middle" font-family="sans-serif" font-size="11" fill="#262523">Holiday Apartments</text>
</svg>
`);

const SVG_PROCESS_DIAGRAM = svgToDataUrl(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 360" width="640" height="360">
  <rect width="640" height="360" fill="#FAF8F5"/>
  <text x="320" y="30" text-anchor="middle" font-family="Georgia, serif" font-size="14" font-weight="bold" fill="#262523">Plastic Bottle Recycling Process (6 Key Stages)</text>
  <g font-family="sans-serif" font-size="11" fill="#262523" text-anchor="middle">
    <rect x="45" y="68" width="155" height="86" rx="8" fill="#FFFFFF" stroke="#D5D0C3" stroke-width="1.5"/>
    <text x="122" y="96" font-family="monospace" font-weight="bold" fill="#EA5B25">STAGE 01</text>
    <text x="122" y="118" font-weight="bold">Collection &amp; Transport</text>
    <text x="122" y="136" font-size="10" fill="#7A7873">Bins → Recycling Truck</text>
    <path d="M206,111 L236,111" stroke="#EA5B25" stroke-width="2"/>
    <polygon points="236,107 244,111 236,115" fill="#EA5B25"/>
    <rect x="245" y="68" width="155" height="86" rx="8" fill="#FFFFFF" stroke="#D5D0C3" stroke-width="1.5"/>
    <text x="322" y="96" font-family="monospace" font-weight="bold" fill="#EA5B25">STAGE 02</text>
    <text x="322" y="118" font-weight="bold">Sorting &amp; Grading</text>
    <text x="322" y="136" font-size="10" fill="#7A7873">Conveyor Belt Inspection</text>
    <path d="M406,111 L436,111" stroke="#EA5B25" stroke-width="2"/>
    <polygon points="436,107 444,111 436,115" fill="#EA5B25"/>
    <rect x="445" y="68" width="155" height="86" rx="8" fill="#FFFFFF" stroke="#D5D0C3" stroke-width="1.5"/>
    <text x="522" y="96" font-family="monospace" font-weight="bold" fill="#EA5B25">STAGE 03</text>
    <text x="522" y="118" font-weight="bold">Compressing &amp; Crushing</text>
    <text x="522" y="136" font-size="10" fill="#7A7873">Blocks → Shredded Flakes</text>
    <path d="M522,158 L522,196" stroke="#EA5B25" stroke-width="2"/>
    <polygon points="518,196 522,204 526,196" fill="#EA5B25"/>
    <rect x="445" y="208" width="155" height="86" rx="8" fill="#FFFFFF" stroke="#D5D0C3" stroke-width="1.5"/>
    <text x="522" y="236" font-family="monospace" font-weight="bold" fill="#2E7D5B">STAGE 04</text>
    <text x="522" y="258" font-weight="bold">Washing &amp; Heating</text>
    <text x="522" y="276" font-size="10" fill="#7A7873">Purified &amp; Melted</text>
    <path d="M440,251 L410,251" stroke="#2E7D5B" stroke-width="2"/>
    <polygon points="410,247 402,251 410,255" fill="#2E7D5B"/>
    <rect x="245" y="208" width="155" height="86" rx="8" fill="#FFFFFF" stroke="#D5D0C3" stroke-width="1.5"/>
    <text x="322" y="236" font-family="monospace" font-weight="bold" fill="#2E7D5B">STAGE 05</text>
    <text x="322" y="258" font-weight="bold">Plastic Pellets</text>
    <text x="322" y="276" font-size="10" fill="#7A7873">Raw Granules Extruded</text>
    <path d="M240,251 L210,251" stroke="#2E7D5B" stroke-width="2"/>
    <polygon points="210,247 202,251 210,255" fill="#2E7D5B"/>
    <rect x="45" y="208" width="155" height="86" rx="8" fill="#FAF0EC" stroke="#EA5B25" stroke-width="1.5"/>
    <text x="122" y="236" font-family="monospace" font-weight="bold" fill="#EA5B25">STAGE 06</text>
    <text x="122" y="258" font-weight="bold">New Consumer Goods</text>
    <text x="122" y="276" font-size="10" fill="#7A7873">Bottles, Bags &amp; Clothing</text>
  </g>
</svg>
`);

export const BUILTIN_TASK1_TOPIC_BANK: Task1TopicBankItem[] = [
  {
    id: 't1-chart-1',
    prompt:
      'The line graph shows the percentage of electricity generated from renewable sources in four countries (Germany, Sweden, the UK, and Australia) between 1990 and 2025. Summarise the information by selecting and reporting the main features, and make comparisons where relevant.',
    chartImage: SVG_LINE_GRAPH,
    chartType: '折线图',
    bestBand: null,
    attemptCount: 0,
    lastEssayId: null,
    updatedAt: '2025-01-01T00:00:00.000Z',
    isBuiltIn: true,
  },
  {
    id: 't1-chart-2',
    prompt:
      'The bar chart illustrates the proportion of household income spent on five categories (housing, food, transport, healthcare, and leisure) across three income groups in 2024. Summarise the information by selecting and reporting the main features, and make comparisons where relevant.',
    chartImage: SVG_BAR_CHART,
    chartType: '柱状图',
    bestBand: null,
    attemptCount: 0,
    lastEssayId: null,
    updatedAt: '2025-01-01T00:00:00.000Z',
    isBuiltIn: true,
  },
  {
    id: 't1-chart-3',
    prompt:
      'The two pie charts show the percentages of total energy production from five different fuel sources in France in 1995 and 2025. Summarise the information by selecting and reporting the main features, and make comparisons where relevant.',
    chartImage: SVG_PIE_CHART,
    chartType: '饼图',
    bestBand: null,
    attemptCount: 0,
    lastEssayId: null,
    updatedAt: '2025-01-01T00:00:00.000Z',
    isBuiltIn: true,
  },
  {
    id: 't1-chart-4',
    prompt:
      'The table gives information about the underground railway systems in six major cities (London, Paris, Tokyo, Washington DC, Kyoto, and Los Angeles) in terms of date opened, route length, and annual passenger numbers. Summarise the information by selecting and reporting the main features, and make comparisons where relevant.',
    chartImage: SVG_TABLE_CHART,
    chartType: '表格',
    bestBand: null,
    attemptCount: 0,
    lastEssayId: null,
    updatedAt: '2025-01-01T00:00:00.000Z',
    isBuiltIn: true,
  },
  {
    id: 't1-chart-5',
    prompt:
      'The two maps show the layout of a coastal town called Seaville in 1995 and how it was redeveloped into a modern tourist resort by 2025. Summarise the information by selecting and reporting the main changes.',
    chartImage: SVG_MAP_COMPARISON,
    chartType: '地图',
    bestBand: null,
    attemptCount: 0,
    lastEssayId: null,
    updatedAt: '2025-01-01T00:00:00.000Z',
    isBuiltIn: true,
  },
  {
    id: 't1-chart-6',
    prompt:
      'The diagram illustrates the process by which plastic bottles are collected, sorted, and recycled into new consumer products and clothing fibers. Summarise the information by selecting and reporting the main stages.',
    chartImage: SVG_PROCESS_DIAGRAM,
    chartType: '流程图',
    bestBand: null,
    attemptCount: 0,
    lastEssayId: null,
    updatedAt: '2025-01-01T00:00:00.000Z',
    isBuiltIn: true,
  },
];

export const MASTER_WRITING_PROMPTS: MasterWritingPrompt[] = [
  // 1. 科技与未来 · Technology (4 prompts)
  {
    id: 't2-tech-1',
    taskType: 'task2',
    topicTag: '科技与未来 · Technology',
    prompt:
      'Some people believe that artificial intelligence and online learning platforms will soon replace classroom teachers completely, while others argue that human teachers remain irreplaceable. Discuss both views and give your own opinion.',
  },
  {
    id: 't2-tech-2',
    taskType: 'task2',
    topicTag: '科技与未来 · Technology',
    prompt:
      'More and more people today are using social media and smartphones to communicate with others rather than meeting face to face. Do the advantages of this development outweigh the disadvantages?',
  },
  {
    id: 't2-tech-3',
    taskType: 'task2',
    topicTag: '科技与未来 · Technology',
    prompt:
      'In the future, all cars, buses, and trucks will be driverless. The only people travelling inside these vehicles will be passengers. Do you think the advantages of driverless vehicles outweigh the disadvantages?',
  },
  {
    id: 't2-tech-4',
    taskType: 'task2',
    topicTag: '科技与未来 · Technology',
    prompt:
      'Modern technology has made it possible for many employees to work from home rather than commuting to an office every day. Do you think this is a positive or negative development for workers and employers?',
  },

  // 2. 教育公平 · Education (4 prompts)
  {
    id: 't2-edu-1',
    taskType: 'task2',
    topicTag: '教育公平 · Education',
    prompt:
      'Some people think that universities should provide graduates with the knowledge and skills needed in the workplace. Others think that the true function of a university should be to give access to knowledge for its own sake. Discuss both views and give your own opinion.',
  },
  {
    id: 't2-edu-2',
    taskType: 'task2',
    topicTag: '教育公平 · Education',
    prompt:
      'In many countries, children from wealthier families have access to better educational resources than those from low-income households. What problems does this disparity cause, and what measures can governments take to ensure educational equity?',
  },
  {
    id: 't2-edu-3',
    taskType: 'task2',
    topicTag: '教育公平 · Education',
    prompt:
      'Some educators believe that every child should be taught how to play a musical instrument or participate in artistic activities at school, while others argue that school time should be devoted strictly to core academic subjects. To what extent do you agree or disagree?',
  },
  {
    id: 't2-edu-4',
    taskType: 'task2',
    topicTag: '教育公平 · Education',
    prompt:
      'Full-time university students spend most of their time studying. Some people think they should also be required to participate in community service or voluntary work. To what extent do you agree or disagree?',
  },

  // 3. 环保与生态 · Environment (4 prompts)
  {
    id: 't2-env-1',
    taskType: 'task2',
    topicTag: '环保与生态 · Environment',
    prompt:
      'Some people think that the best way to solve global environmental problems is to increase the cost of fuel for cars and other vehicles. To what extent do you agree or disagree?',
  },
  {
    id: 't2-env-2',
    taskType: 'task2',
    topicTag: '环保与生态 · Environment',
    prompt:
      'Plastic bags, disposable packaging, and single-use bottles are causing severe land and ocean pollution. What damage does plastic waste cause to the ecosystem, and what steps can governments and individuals take to address this issue?',
  },
  {
    id: 't2-env-3',
    taskType: 'task2',
    topicTag: '环保与生态 · Environment',
    prompt:
      'Human activities have brought many animal and plant species to the brink of extinction. Some people say we should only protect species that are directly useful to humans. To what extent do you agree or disagree?',
  },
  {
    id: 't2-env-4',
    taskType: 'task2',
    topicTag: '环保与生态 · Environment',
    prompt:
      'International air travel has become remarkably cheap and accessible in recent decades, yet it contributes significantly to carbon emissions. Should governments impose heavy environmental taxes on airline tickets to restrict air travel?',
  },

  // 4. 政府与经济 · Governance (4 prompts)
  {
    id: 't2-gov-1',
    taskType: 'task2',
    topicTag: '政府与经济 · Governance',
    prompt:
      'Some people think that governments should spend public money on space exploration, while others argue that tax revenues should be used to solve urgent problems on Earth such as healthcare and poverty. Discuss both views and give your own opinion.',
  },
  {
    id: 't2-gov-2',
    taskType: 'task2',
    topicTag: '政府与经济 · Governance',
    prompt:
      'Economic growth is often considered the most important goal for developing nations. However, some people argue that rapid economic expansion inevitably widens the gap between the rich and the poor. To what extent do you agree or disagree?',
  },
  {
    id: 't2-gov-3',
    taskType: 'task2',
    topicTag: '政府与经济 · Governance',
    prompt:
      'In many countries, the proportion of older people is steadily increasing. Does this demographic trend have more positive or negative effects on society and the national economy?',
  },
  {
    id: 't2-gov-4',
    taskType: 'task2',
    topicTag: '政府与经济 · Governance',
    prompt:
      'Public museums and art galleries should be funded by government subsidies so that admission is free for all citizens. To what extent do you agree or disagree with this statement?',
  },

  // 5. 犯罪与社会 · Crime & Society (4 prompts)
  {
    id: 't2-soc-1',
    taskType: 'task2',
    topicTag: '犯罪与社会 · Crime & Society',
    prompt:
      'Research indicates that the majority of released prisoners commit further crimes after leaving prison. What are the main causes of this high reoffending rate, and how can rehabilitation programs be improved?',
  },
  {
    id: 't2-soc-2',
    taskType: 'task2',
    topicTag: '犯罪与社会 · Crime & Society',
    prompt:
      'Some people believe that there should be fixed punishments for each type of crime. Others, however, argue that the circumstances of an individual crime, and the motivation for committing it, should always be taken into account. Discuss both views and give your own opinion.',
  },
  {
    id: 't2-soc-3',
    taskType: 'task2',
    topicTag: '犯罪与社会 · Crime & Society',
    prompt:
      'In many cities, the installation of CCTV surveillance cameras in public spaces has increased dramatically. While this helps deter crime, critics argue it invades personal privacy. Do the benefits of public surveillance outweigh the drawbacks?',
  },
  {
    id: 't2-soc-4',
    taskType: 'task2',
    topicTag: '犯罪与社会 · Crime & Society',
    prompt:
      'Juvenile delinquency is rising in many urban areas. Some people claim that parents should be held legally responsible for crimes committed by their underage children. To what extent do you agree or disagree?',
  },

  // 6. 传统文化 · Culture & Tradition (4 prompts)
  {
    id: 't2-cul-1',
    taskType: 'task2',
    topicTag: '传统文化 · Culture & Tradition',
    prompt:
      'Several languages are dying out every year. Some people do not think this is important because life will be easier if there are fewer languages in the world. To what extent do you agree or disagree?',
  },
  {
    id: 't2-cul-2',
    taskType: 'task2',
    topicTag: '传统文化 · Culture & Tradition',
    prompt:
      'In many rapidly modernizing cities, historic buildings are being demolished to make way for contemporary skyscrapers and commercial centers. How important is it to preserve historic architecture, and how can preservation be balanced with urban development?',
  },
  {
    id: 't2-cul-3',
    taskType: 'task2',
    topicTag: '传统文化 · Culture & Tradition',
    prompt:
      'International tourism has become one of the largest industries in the world. Unfortunately, it often creates tension between visitors and local residents rather than fostering cross-cultural understanding. What are the reasons for this, and how can it be resolved?',
  },
  {
    id: 't2-cul-4',
    taskType: 'task2',
    topicTag: '传统文化 · Culture & Tradition',
    prompt:
      'As global media and multinational brands become ubiquitous, young people across different countries are adopting similar lifestyles and consumer habits. Do you think the advantages of cultural globalization outweigh the loss of local traditions?',
  },

  // Task 1 Prompts (Academic Charts / Process / Maps)
  {
    id: 't1-chart-1',
    taskType: 'task1',
    topicTag: '动态折线图 · Line Graph',
    prompt:
      'The line graph shows the percentage of electricity generated from renewable sources in four countries (Germany, Sweden, the UK, and Australia) between 1990 and 2025. Summarise the information by selecting and reporting the main features, and make comparisons where relevant.',
  },
  {
    id: 't1-chart-2',
    taskType: 'task1',
    topicTag: '静态柱状图 · Bar Chart',
    prompt:
      'The bar chart illustrates the proportion of household income spent on five categories (housing, food, transport, healthcare, and leisure) across three income groups in 2024. Summarise the information by selecting and reporting the main features, and make comparisons where relevant.',
  },
  {
    id: 't1-chart-3',
    taskType: 'task1',
    topicTag: '流程图 · Process Diagram',
    prompt:
      'The diagram illustrates the process by which plastic bottles are collected, sorted, and recycled into new consumer products and clothing fibers. Summarise the information by selecting and reporting the main stages.',
  },
  {
    id: 't1-chart-4',
    taskType: 'task1',
    topicTag: '地图变迁 · Map Comparison',
    prompt:
      'The two maps show the layout of a coastal town called Seaville in 1995 and how it was redeveloped into a modern tourist resort by 2025. Summarise the information by selecting and reporting the main changes.',
  },
];
