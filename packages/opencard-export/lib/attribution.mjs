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
 * summary footer. Kept short; English-only.
 * @param {string|null|undefined} [issuer]
 * @returns {string}
 */
export function attributionNotice(issuer) {
  const line = attributionLine(issuer);
  return [
    'Attribution:',
    '  • Card art remains the copyright of the issuing bank / network.',
    '    Export is intended solely for contributing to OpenCard DB.',
    '  • OpenCard DB operates a takedown channel (see SECURITY.md) for rights holders.',
    '  • Suggested image.attribution:',
    `      ${line}`,
  ].join('\n');
}
