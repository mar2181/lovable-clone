// Test the SVG data URI sanitizer - direct logic test
const brokenCode = `<div style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%239C92AC' fill-opacity='0.4'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")' }} />`;

console.log("=== BROKEN CODE ===");
console.log(brokenCode);
console.log("\n=== ANALYSIS ===");

// Count quotes
const singleCount = (brokenCode.match(/(?<!\\)'/g) || []).length;
const doubleCount = (brokenCode.match(/(?<!\\)"/g) || []).length;
console.log("Single quotes:", singleCount);
console.log("Double quotes:", doubleCount);

// Test: does it have data:image/svg+xml?
console.log("\nHas data:image/svg+xml:", brokenCode.includes('data:image/svg+xml'));

// Test: find start
const startIdx = brokenCode.indexOf('data:image/svg+xml,');
console.log("Start index:", startIdx);

// Test: find SVG end marker
const svgEnd = brokenCode.indexOf('%3C/svg%3E', startIdx);
console.log("SVG end index:", svgEnd);

if (svgEnd !== -1) {
  const endIdx = svgEnd + '%3C/svg%3E'.length;
  const afterSvg = brokenCode.substring(endIdx, endIdx + 10);
  console.log("After SVG:", JSON.stringify(afterSvg));
  
  const svgUri = brokenCode.substring(startIdx, endIdx);
  console.log("SVG URI extracted, length:", svgUri.length);
  console.log("SVG URI first 80 chars:", svgUri.substring(0, 80));
  
  // Test the regex: style={{ ... }}
  const styleRegex = /style=\{\{[^}]*\}\}/;
  const match = brokenCode.match(styleRegex);
  console.log("\nstyle regex match:", match ? "YES" : "NO");
  if (match) {
    console.log("Matched:", match[0].substring(0, 100));
  }
  
  // The PROBLEM: the broken code has single quotes inside the SVG data that break
  // out of the outer single-quoted string. Let's check if the regex can still match.
  // The regex style={{ ... }} uses [^}]* which matches anything except }
  // But the SVG data has } characters in it! So [^}]* will STOP at the first }
  // inside the SVG data, not match the full style={{ ... }} block.
  
  // Let's verify:
  const firstCloseBrace = brokenCode.indexOf('}', startIdx);
  console.log("\nFirst } after start:", firstCloseBrace);
  console.log("Character at that position:", brokenCode[firstCloseBrace-1], brokenCode[firstCloseBrace], brokenCode[firstCloseBrace+1]);
  
  // Better regex: match style={{ ... }} greedily
  const greedyRegex = /style=\{\{[\s\S]*?\}\}/;
  const greedyMatch = brokenCode.match(greedyRegex);
  console.log("\nGreedy regex match:", greedyMatch ? "YES" : "NO");
  if (greedyMatch) {
    console.log("Greedy matched:", greedyMatch[0].substring(0, 100));
    console.log("Greedy match length:", greedyMatch[0].length);
  }
}

// Now test the ACTUAL fix approach
console.log("\n=== TESTING FIX ===");
let code = brokenCode;
const fixLines = code.split('\n');
for (let i = 0; i < fixLines.length; i++) {
  const line = fixLines[i];
  if (!line.includes('data:image/svg+xml')) continue;
  
  const startIdx2 = line.indexOf('data:image/svg+xml,');
  if (startIdx2 === -1) continue;
  
  const svgEnd2 = line.indexOf('%3C/svg%3E', startIdx2);
  if (svgEnd2 === -1) continue;
  
  const endIdx2 = svgEnd2 + '%3C/svg%3E'.length;
  const svgUri = line.substring(startIdx2, endIdx2);
  
  // The current sanitizer uses: /style=\{\{[^}]*\}\}/
  // This WILL NOT WORK because SVG data contains } chars
  const oldRegex = /style=\{\{[^}]*\}\}/;
  const oldResult = line.replace(oldRegex, `style={{ backgroundImage: \`url("${svgUri}")\` }}`);
  console.log("Old regex works:", oldResult !== line ? "YES" : "NO");
  
  // Better approach: use a greedy/non-greedy regex or just replace the whole line
  // Or: find style={{ and match to the matching }}
  const betterRegex = /style=\{\{[\s\S]*?\}\}\s*/;
  const betterResult = line.replace(betterRegex, `style={{ backgroundImage: \`url("${svgUri}")\` }} `);
  console.log("Better regex works:", betterResult !== line ? "YES" : "NO");
  if (betterResult !== line) {
    console.log("Fixed line:", betterResult);
  }
}
