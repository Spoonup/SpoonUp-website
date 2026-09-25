import React from 'react';
import Button from '../components/ui/Button';
import Eyebrow from '../components/ui/Eyebrow';
import Container from '../components/layout/Container';

/**
 * TODO: Handle core functionality later.
 * Holding page for screens scheduled in a later batch (checkout, confirmation,
 * account, sign-in, our story, legal). Keeps every route in the design reachable
 * so navigation can be reviewed end to end.
 */
export default function Placeholder({ screen, title, blurb, batch = 'a later batch' }) {
  return (
    <Container width="prose" className="py-24 text-center">
      {screen && <Eyebrow>Screen {screen}</Eyebrow>}
      <h1 className="font-display text-[36px] sm:text-[44px] text-ink mt-4 mb-0">{title}</h1>
      <p className="text-[14.5px] leading-[1.65] text-ink-65 mt-4 mb-0">{blurb}</p>
      <p className="text-[12.5px] text-ink-50 mt-6 mb-7">
        Designed and specified — scheduled for {batch}.
      </p>
      <div className="flex gap-3 justify-center flex-wrap">
        <Button to="/" variant="outline" size="md">
          Back to home
        </Button>
        <Button to="/shop" variant="primary" size="md">
          Browse the shop
        </Button>
      </div>
    </Container>
  );
}
