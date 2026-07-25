import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_CARD_IMAGE_PATH,
  defaultCardImageUrl,
  withDefaultCardImage,
} from "../../worker/src/card-image.ts";

describe("withDefaultCardImage", () => {
  const origin = "https://api.example.com";

  it("fills null image with absolute default asset URL", () => {
    const card = withDefaultCardImage(
      { id: "us-demo", image: null },
      origin,
    );
    assert.deepEqual(card.image, {
      url: `${origin}${DEFAULT_CARD_IMAGE_PATH}`,
      attribution: "OpenCard DB generic placeholder (not bank artwork)",
      local_path: "images/default-card.webp",
    });
  });

  it("fills missing image.url while preserving attribution", () => {
    const card = withDefaultCardImage(
      {
        id: "ca-demo",
        image: { url: null, attribution: "Issuer ©", local_path: null },
      },
      origin,
    );
    assert.equal(card.image?.url, `${origin}${DEFAULT_CARD_IMAGE_PATH}`);
    assert.equal(card.image?.attribution, "Issuer ©");
    assert.equal(card.image?.local_path, "images/default-card.webp");
  });

  it("leaves real issuer image URLs unchanged", () => {
    const url = "https://banks.example/card.png";
    const card = withDefaultCardImage(
      {
        id: "us-real",
        image: {
          url,
          attribution: "Bank ©",
          local_path: "images/us-real.webp",
        },
      },
      origin,
    );
    assert.equal(card.image?.url, url);
    assert.equal(card.image?.local_path, "images/us-real.webp");
  });

  it("builds default URL from request origin", () => {
    assert.equal(
      defaultCardImageUrl("https://host.example"),
      "https://host.example/v1/assets/default-card.webp",
    );
  });
});
