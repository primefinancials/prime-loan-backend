/**
 * Mono status-mapper tests. Fixtures below are REAL `GET /v3/payments/mandates/{id}`
 * responses captured from the live Mono API (Sept 2026) — including the important
 * quirk that a CANCELLED mandate still reports `ready_to_debit: true`.
 */
import { mapMonoMandateStatus, classifyMonoWebhook, extractMandateId, extractDebitReferences } from '../mono.status';

const realCancelled = {
  status: 'successful',
  data: {
    id: 'mmc_6a6b2c6c989175281f6733d0',
    status: 'cancelled',
    approved: false,
    ready_to_debit: true, // <- Mono really returns this on a cancelled mandate
    account_name: 'IRABOR ESE DANIEL',
    account_number: '3098048846',
  },
};

const realApproved = {
  status: 'successful',
  data: {
    id: 'mmc_6a6b2114793b6786c21ea7e6',
    status: 'approved',
    approved: true,
    ready_to_debit: true,
    account_name: 'IGHODARO DOMINIC',
    account_number: '3657502014',
  },
};

describe('mapMonoMandateStatus', () => {
  it('maps a cancelled mandate to cancelled even when ready_to_debit is true', () => {
    const r = mapMonoMandateStatus(realCancelled);
    expect(r.local).toBe('cancelled');
    expect(r.readyToDebit).toBe(false);
    expect(r.terminal).toBe(true);
  });

  it('maps an approved + ready mandate to active/debitable', () => {
    const r = mapMonoMandateStatus(realApproved);
    expect(r.local).toBe('active');
    expect(r.readyToDebit).toBe(true);
    expect(r.terminal).toBe(false);
  });

  it('maps approved-but-not-ready to approved (not debitable)', () => {
    const r = mapMonoMandateStatus({ data: { status: 'approved', approved: true, ready_to_debit: false } });
    expect(r.local).toBe('approved');
    expect(r.readyToDebit).toBe(false);
  });

  it.each([
    ['rejected', 'rejected', true],
    ['expired', 'expired', true],
    ['revoked', 'cancelled', true],
    ['failed', 'failed', true],
  ])('maps terminal status %s', (raw, local, terminal) => {
    const r = mapMonoMandateStatus({ data: { status: raw, ready_to_debit: true } });
    expect(r.local).toBe(local);
    expect(r.terminal).toBe(terminal);
    expect(r.readyToDebit).toBe(false);
  });

  it('treats paused as recoverable / not debitable / not terminal', () => {
    const r = mapMonoMandateStatus({ data: { status: 'paused', approved: true } });
    expect(r.readyToDebit).toBe(false);
    expect(r.terminal).toBe(false);
  });

  it('accepts a bare webhook data object (no envelope)', () => {
    const r = mapMonoMandateStatus({ status: 'approved', approved: true, ready_to_debit: true });
    expect(r.local).toBe('active');
  });

  it('defaults unknown / empty to pending', () => {
    expect(mapMonoMandateStatus({}).local).toBe('pending');
    expect(mapMonoMandateStatus({ data: { status: 'something_new' } }).local).toBe('pending');
  });
});

describe('classifyMonoWebhook', () => {
  it.each([
    ['events.mandates.created', 'mandate.created'],
    ['events.mandates.approved', 'mandate.approved'],
    ['events.mandates.ready', 'mandate.ready'],
    ['events.mandates.rejected', 'mandate.rejected'],
    ['events.mandates.cancelled', 'mandate.cancelled'],
    ['events.mandates.revoked', 'mandate.cancelled'],
    ['events.mandates.reinstated', 'mandate.reinstated'],
    ['events.mandates.debit.successful', 'debit.successful'],
    ['events.mandates.debit.failed', 'debit.failed'],
    ['events.mandates.debit.processing', 'debit.processing'],
    ['some.unknown.event', 'unknown'],
  ])('%s -> %s', (event, intent) => {
    expect(classifyMonoWebhook(event)).toBe(intent);
  });
});

describe('extractMandateId / extractDebitReferences', () => {
  it('pulls mandate id from the various shapes', () => {
    expect(extractMandateId({ mandate: 'mmc_1' })).toBe('mmc_1');
    expect(extractMandateId({ id: 'mmc_2' })).toBe('mmc_2');
    expect(extractMandateId({ mandate_id: 'mmc_3' })).toBe('mmc_3');
  });
  it('pulls + dedupes debit references', () => {
    expect(extractDebitReferences({ reference_number: 'r1', reference: 'r1' })).toEqual(['r1']);
    expect(extractDebitReferences({ reference: 'r2', session_id: 's2' }).sort()).toEqual(['r2', 's2']);
  });
});
