const fs = require('fs');
const path = require('path');
function walk(dir) {
  let results = [];
  const list = fs.readdirSync(dir);
  list.forEach(file => {
    file = path.join(dir, file);
    const stat = fs.statSync(file);
    if (stat && stat.isDirectory()) {
      results = results.concat(walk(file));
    } else if (file.endsWith('.tsx') || file.endsWith('.ts') || file.endsWith('.js') || file.endsWith('.css')) {
      results.push(file);
    }
  });
  return results;
}
const files = walk('src');
const mappings = [
  { bad: /Ã¢â‚¬â€ /g, good: '—' },
  { bad: /Ã¢â‚¬Å“/g, good: '"' },
  { bad: /Ã¢â‚¬â„¢/g, good: "'" },
  { bad: /Ã¢â‚¬Â /g, good: '"' },
  { bad: /Ã¢â‚¬Â¢/g, good: '•' },
  { bad: /Ã¢â‚¬Â¦/g, good: '...' }
];
let changedFiles = 0;
files.forEach(file => {
  const content = fs.readFileSync(file, 'utf8');
  let newContent = content;
  mappings.forEach(m => {
    newContent = newContent.replace(m.bad, m.good);
  });
  if (content !== newContent) {
    fs.writeFileSync(file, newContent, 'utf8');
    changedFiles++;
    console.log('Fixed ' + file);
  }
});
console.log('Total files changed: ' + changedFiles);
