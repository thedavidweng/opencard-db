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
 * Copyright notice printed once after an export (only when files were written).
 * One line, gh-style restraint; SECURITY.md documents the takedown channel.
 * @returns {string}
 */
export function attributionNotice() {
  return 'Card art remains the copyright of the issuing bank; export is only for contributing to OpenCard DB (takedown: SECURITY.md).';
}
