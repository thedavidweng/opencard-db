// attribution.mjs — copyright / attribution messaging for exported card art.
//
// Card face artwork is NOT owned by OpenCard DB or by the contributor. It stays
// the copyright of the issuing bank / payment network. These helpers keep that
// message front-and-center whenever art is copied off a machine.

/**
 * The one-line attribution string a contributor should paste into a card's
 * `image.attribution` field.
 * @param {string|null|undefined} issuer
 * @returns {string}
 */
export function attributionLine(issuer) {
  const name = (issuer && String(issuer).trim()) || 'Issuer';
  return `© ${name} (Apple Pay digital card art)`;
}

/**
 * Full attribution / copyright notice printed after an export and once as a
 * summary footer. Kept short and bilingual.
 * @param {string|null|undefined} [issuer]
 * @returns {string}
 */
export function attributionNotice(issuer) {
  const line = attributionLine(issuer);
  return [
    '版权归属 / Attribution:',
    '  • 卡面版权仍归发卡行 / 网络所有；导出仅用于向 OpenCard DB 贡献。',
    '    Card art remains the copyright of the issuing bank / network.',
    '    Export is intended solely for contributing to OpenCard DB.',
    '  • OpenCard DB 运营撤下渠道（见 SECURITY.md），权利人可要求移除。',
    '    OpenCard DB operates a takedown channel (see SECURITY.md) for rights holders.',
    `  • 建议在 image.attribution 中写：/ Suggested image.attribution:`,
    `      ${line}`,
  ].join('\n');
}
