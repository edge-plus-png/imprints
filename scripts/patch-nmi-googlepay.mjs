import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const replacements = [
  {
    file: "node_modules/@nmipayments/nmi-pay-react/dist/index.js",
    from: "merchantName:Vn(A).merchantName,testMode:!0,googlePay:v().googlePay,applePay:v().applePay",
    to: 'merchantName:Vn(A).merchantName,testMode:"TEST"===((v().googlePay||{}).environment||"PRODUCTION"),googlePay:v().googlePay,applePay:v().applePay',
  },
  {
    file: "node_modules/@nmipayments/nmi-pay-react/dist/index.cjs",
    from: "merchantName:Dn(A).merchantName,testMode:!0,googlePay:v().googlePay,applePay:v().applePay",
    to: 'merchantName:Dn(A).merchantName,testMode:"TEST"===((v().googlePay||{}).environment||"PRODUCTION"),googlePay:v().googlePay,applePay:v().applePay',
  },
];

for (const replacement of replacements) {
  const fullPath = path.join(process.cwd(), replacement.file);
  const source = await readFile(fullPath, "utf8");

  if (!source.includes(replacement.from)) {
    if (source.includes(replacement.to)) continue;
    throw new Error(`Patch target not found in ${replacement.file}`);
  }

  await writeFile(fullPath, source.replace(replacement.from, replacement.to));
}

console.log("Patched @nmipayments/nmi-pay-react Google Pay test mode handling.");
