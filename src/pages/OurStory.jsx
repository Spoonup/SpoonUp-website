import React from 'react';
import Eyebrow from '../components/ui/Eyebrow';
import Button from '../components/ui/Button';
import Container from '../components/layout/Container';

export default function OurStory() {
  return (
    <>
      <section className="bg-cream">
        <Container width="prose" className="py-16 lg:py-20 text-center">
          <Eyebrow>Our story</Eyebrow>
          <h1 className="font-display text-[38px] sm:text-[52px] leading-[1.05] text-ink mt-4 mb-0">
            Good food, <em className="italic">higher days</em>.
          </h1>
          <p className="text-[16px] leading-[1.7] text-ink-72 mt-5 mb-0">
            SpoonUp started in a Bengaluru kitchen with one stubborn idea: food that is genuinely
            nourishing should not taste like a compromise.
          </p>
        </Container>
      </section>

      <Container width="prose" className="py-16 space-y-6">
        {/* TODO: Handle core functionality later — final copy from the product owner */}
        <p className="text-[15px] leading-[1.75] text-ink-72 m-0">
          We make everything in small batches. No refined sugar goes into any of it, the protein is
          real, and the label tells you exactly what is in the jar. The dry fruits come from growers
          in Kashmir we buy from directly, season after season.
        </p>
        <p className="text-[15px] leading-[1.75] text-ink-72 m-0">
          Subscriptions exist because the hardest part of eating well is not the food — it is the
          deciding. Pick a rhythm once and let it run. Skip a week when you travel. Nothing you paid
          for ever disappears.
        </p>
        <div className="pt-4">
          <Button to="/subscribe" variant="primary" size="lg">
            Build a subscription
          </Button>
        </div>
      </Container>
    </>
  );
}
