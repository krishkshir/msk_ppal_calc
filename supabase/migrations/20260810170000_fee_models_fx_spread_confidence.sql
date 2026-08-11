-- Splits fee_models.confidence (which describes the commercial rate/fixed
-- fee) from a separate fx_spread_confidence column. Discovered while
-- wiring the active model into engine.ts (docs/plan-v0.5.html): the seed
-- row's confidence='observed' correctly describes T1-T3's commercial
-- rate, but the FX spread has never been validated by any observation —
-- a single shared column would have made the 4% spread display as
-- "observed" the moment any ledger model was accepted, for every
-- currency, regardless of whether its spread was ever actually solved.
alter table public.fee_models
  add column fx_spread_confidence text not null default 'estimated'
    check (fx_spread_confidence in ('observed', 'estimated', 'unvalidated'));
