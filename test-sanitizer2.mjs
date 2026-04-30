// Test improved SVG sanitizer
const brokenCode1 = `<div style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%239C92AC' fill-opacity='0.4'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")', backgroundSize: '60px 60px' }} />`;

const brokenCode2 = `<div style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg width='20' height='20' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='%239C92AC' fill-opacity='0.2'%3E%3Ccircle cx='3' cy='3' r='3'/%3E%3C/g%3E%3C/svg%3E")' }} />`;

function testSanitizer(code, label) {
  console.log(`\n=== ${label} ===`);
  console.log("INPUT:", code.substring(0, 150) + "...");

  // Apply Rule 5 fix (improved)
  const fixLines = code.split('\n');
  for (let i = 0; i < fixLines.length; i++) {
    const line = fixLines[i];
    if (!line.includes('data:image/svg+xml')) continue;

    const startIdx = line.indexOf('data:image/svg+xml,');
    if (startIdx === -1) continue;

    const svgEnd = line.indexOf('%3C/svg%3E', startIdx);
    if (svgEnd === -1) continue;

    const endIdx = svgEnd + '%3C/svg%3E'.length;
    const svgUri = line.substring(startIdx, endIdx);

    const newLine = line.replace(
      /style=\{\{[\s\S]*?\}\}/,
      (match) => {
        return match.replace(
          /backgroundImage:\s*['"]?url\([^)]*\)['"]?/,
          `backgroundImage: \`url("${svgUri}")\``
        );
      }
    );
    
    if (newLine !== line) {
      fixLines[i] = newLine;
      console.log("FIXED!");
    } else {
      console.log("NO FIX APPLIED");
    }
  }
  const result = fixLines.join('\n');
  console.log("OUTPUT:", result.substring(0, 200) + "...");
  
  // Verify: no unmatched quotes
  const singleCount = (result.match(/(?<!\\)'/g) || []).length;
  const doubleCount = (result.match(/(?<!\\)"/g) || []).length;
  console.log(`Quotes: single=${singleCount} (${singleCount % 2 === 0 ? 'EVEN ✓' : 'ODD ✗'}), double=${doubleCount} (${doubleCount % 2 === 0 ? 'EVEN ✓' : 'ODD ✗'})`);
  
  return result;
}

testSanitizer(brokenCode1, "SVG with extra style props");
testSanitizer(brokenCode2, "SVG without extra style props");
