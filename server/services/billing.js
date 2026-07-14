import db from '../db/database.js';
import {
    BILLING_OPERATIONS,
    BillingError,
    handleBillingError,
} from './billingCore.js';
import {
    calculateCustomerCreditsFromMetaCost as calculateCustomerCreditsFromMetaCostMath,
} from './billingMath.js';
import {
    createMetaRate as createMetaRateRecord,
    listMetaRates as listMetaRateRecords,
    upsertMetaRate as upsertMetaRateRecord,
    updateMetaRate as updateMetaRateRecord,
} from './billingMetaRates.js';
import {
    getBillingSettings as getBillingSettingsRecord,
    updateBillingSettings as updateBillingSettingsRecord,
} from './billingSettings.js';
import {
    createInvoice as createInvoiceRecord,
    getInvoices as getInvoiceRecords,
    getLedger as getLedgerRecords,
} from './billingHistory.js';
import {
    ensureTenantBillingAccount as ensureTenantBillingAccountRecord,
    syncTenantCredits as syncTenantCreditsRecord,
} from './billingAccount.js';
import {
    commitBillingUsage,
    releaseBillingUsage,
    reserveBillingUsage,
} from './billingUsage.js';
import {
    applyMonthlyAllowance as applyMonthlyAllowanceMutation,
    recordAdjustment as recordAdjustmentMutation,
    recordPayment as recordPaymentMutation,
    updateTenantBillingAccount as updateTenantBillingAccountMutation,
} from './billingLedgerMutations.js';
import { getBillingSummary as getBillingSummaryRecord } from './billingSummary.js';
import {
    getMetaCostSummary as getMetaCostSummaryRecord,
    getMetaUsage as getMetaUsageRecords,
    listMetaInvoices as listMetaInvoiceRecords,
    listMetaUsageSnapshots as listMetaUsageSnapshotRecords,
} from './billingMetaUsage.js';
import {
    createMetaInvoice as createMetaInvoiceRecord,
    getMetaReconciliation as getMetaReconciliationRecord,
    markMetaReconciliationReviewed as markMetaReconciliationReviewedRecord,
    syncMetaReconciliationPeriod as syncMetaReconciliationPeriodRecord,
} from './billingMetaReconciliation.js';
import {
    getLocalMetaMessageCostSummary as getLocalMetaMessageCostSummaryRecord,
    getLocalMetaReconciliation as getLocalMetaReconciliationRecord,
    getMetaUsageComparison as getMetaUsageComparisonRecord,
    syncMetaUsageSnapshot as syncMetaUsageSnapshotRecord,
} from './billingMetaSync.js';
import { quote as quoteRecord } from './billingQuote.js';
import {
    resolveLocalBillableQuantity as resolveLocalBillableQuantityRecord,
    summarizeMetaEstimate as summarizeMetaEstimateRecord,
    summarizeMetaLikeLocalRecipients as summarizeMetaLikeLocalRecipientsRecord,
    summarizeMetaRecipientCountries as summarizeMetaRecipientCountriesRecord,
} from './billingMetaPricing.js';
import {
    recordMetaMessageCost as recordMetaMessageCostRecord,
    updateUsageMetaEstimate as updateUsageMetaEstimateRecord,
    upsertMetaMessageCostFromStatus as upsertMetaMessageCostFromStatusRecord,
} from './billingMetaMessageCosts.js';
import {
    deferBroadcastReservationUntilStatuses as deferBroadcastReservationUntilStatusesRecord,
    updateMetaChargeFromStatus as updateMetaChargeFromStatusRecord,
} from './billingMetaStatus.js';

export { BILLING_OPERATIONS, BillingError, handleBillingError };

const syncTenantCredits = (tenantId) => syncTenantCreditsRecord(db, tenantId);

function getBillingSettingsValues() {
    return getBillingSettings().settings;
}

const calculateCustomerCreditsFromMetaCost = (metaAmount, settings = getBillingSettingsValues()) => (
    calculateCustomerCreditsFromMetaCostMath(metaAmount, settings)
);

const summarizeMetaEstimate = (options) => summarizeMetaEstimateRecord(db, options);

const metaMessageCostDependencies = { summarizeMetaEstimate };

export function recordMetaMessageCost(options = {}) {
    return recordMetaMessageCostRecord(db, metaMessageCostDependencies, options);
}

const upsertMetaMessageCostFromStatus = (options = {}) => (
    upsertMetaMessageCostFromStatusRecord(db, metaMessageCostDependencies, options)
);

const updateUsageMetaEstimate = (usageId, metadataOverride = null) => (
    updateUsageMetaEstimateRecord(db, metaMessageCostDependencies, usageId, metadataOverride)
);

export function summarizeMetaRecipientCountries(recipients = []) {
    return summarizeMetaRecipientCountriesRecord(db, recipients);
}

export function summarizeMetaLikeLocalRecipients(options = {}) {
    return summarizeMetaLikeLocalRecipientsRecord(db, options);
}

export function resolveLocalBillableQuantity(options = {}) {
    return resolveLocalBillableQuantityRecord(db, options);
}

export function ensureTenantBillingAccount(tenantId) {
    return ensureTenantBillingAccountRecord(db, tenantId);
}

export function quote(options = {}) {
    return quoteRecord(db, { summarizeMetaEstimate }, options);
}

export function reserve(options = {}) {
    return reserveBillingUsage(db, {
        quote,
        getBillingSettings: getBillingSettingsValues,
    }, options);
}

export function commit(reservation, options = {}) {
    return commitBillingUsage(db, {
        getBillingSettings: getBillingSettingsValues,
        recordMetaMessageCost,
        updateUsageMetaEstimate,
    }, reservation, options);
}

export function release(reservation, errorMessage = null) {
    return releaseBillingUsage(db, reservation, errorMessage);
}

const metaStatusDependencies = () => ({
    calculateCustomerCreditsFromMetaCost,
    commit,
    getBillingSettings: getBillingSettingsValues,
    release,
    summarizeMetaEstimate,
    syncTenantCredits,
    upsertMetaMessageCostFromStatus,
});

export function deferBroadcastReservationUntilStatuses(reservation, options = {}) {
    return deferBroadcastReservationUntilStatusesRecord(db, metaStatusDependencies(), reservation, options);
}

export function recordPayment(options = {}) {
    return recordPaymentMutation(db, { getBillingSummary }, options);
}

export function recordAdjustment(options = {}) {
    return recordAdjustmentMutation(db, { getBillingSummary }, options);
}

export function applyMonthlyAllowance(tenantId) {
    return applyMonthlyAllowanceMutation(db, { getBillingSummary }, tenantId);
}

export function updateTenantBillingAccount(tenantId, data = {}) {
    return updateTenantBillingAccountMutation(db, { getBillingSummary }, tenantId, data);
}

export function getLedger(tenantId, { limit = 50, offset = 0, channel = null, operation = null } = {}) {
    return getLedgerRecords(db, tenantId, { limit, offset, channel, operation });
}

export function getInvoices(tenantId, { limit = 20, offset = 0 } = {}) {
    return getInvoiceRecords(db, tenantId, { limit, offset });
}

export function createInvoice(options = {}) {
    return createInvoiceRecord(db, options, {
        ensureTenantBillingAccount,
        creditValueLyd: getBillingSettingsValues().credit_value_lyd,
    });
}

export function getBillingSummary(tenantId, options = {}) {
    return getBillingSummaryRecord(db, tenantId, options);
}

export function updateMetaChargeFromStatus(options = {}) {
    return updateMetaChargeFromStatusRecord(db, metaStatusDependencies(), options);
}

export function listMetaRates({ category = null, currency = null, activeOnly = false } = {}) {
    return listMetaRateRecords(db, { category, currency, activeOnly });
}

export function createMetaRate(data = {}) {
    return createMetaRateRecord(db, data);
}

export function upsertMetaRate(data = {}) {
    return upsertMetaRateRecord(db, data);
}

export function updateMetaRate(id, data = {}) {
    return updateMetaRateRecord(db, id, data);
}

export function getMetaUsage(options = {}) {
    return getMetaUsageRecords(db, options);
}

export function getMetaCostSummary(options = {}) {
    return getMetaCostSummaryRecord(db, options);
}

export function listMetaInvoices(options = {}) {
    return listMetaInvoiceRecords(db, options);
}

export function listMetaUsageSnapshots(options = {}) {
    return listMetaUsageSnapshotRecords(db, options);
}

const getLocalMetaMessageCostSummary = (options) => getLocalMetaMessageCostSummaryRecord(db, options);
const getLocalMetaReconciliation = (options) => getLocalMetaReconciliationRecord(db, options);

export async function syncMetaUsageSnapshot(options = {}) {
    return syncMetaUsageSnapshotRecord(db, options);
}

export function getMetaUsageComparison(options = {}) {
    return getMetaUsageComparisonRecord(db, options);
}

export function getBillingSettings() {
    return getBillingSettingsRecord(db);
}

export function updateBillingSettings(data = {}) {
    return updateBillingSettingsRecord(db, data);
}

const metaReconciliationDependencies = () => ({
    getLocalMetaMessageCostSummary,
    getLocalMetaReconciliation,
    syncMetaUsageSnapshot,
});

export function getMetaReconciliation(options = {}) {
    return getMetaReconciliationRecord(db, metaReconciliationDependencies(), options);
}

export async function syncMetaReconciliationPeriod(options = {}) {
    return syncMetaReconciliationPeriodRecord(db, metaReconciliationDependencies(), options);
}

export function markMetaReconciliationReviewed(options = {}) {
    return markMetaReconciliationReviewedRecord(db, options);
}

export function createMetaInvoice(options = {}) {
    return createMetaInvoiceRecord(db, metaReconciliationDependencies(), options);
}
