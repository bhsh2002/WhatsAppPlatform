const toInteger = (value, fallback = 0) => {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : fallback;
};

export const calculateCustomerCreditsFromMetaCost = (metaAmount, settings = {}) => {
    const exchangeRate = Math.max(Number(settings.meta_cost_exchange_rate_to_lyd) || 1, 0);
    const creditValueLyd = Math.max(Number(settings.credit_value_lyd) || 0.1, 0.0001);
    const marginPercent = Math.max(Number(settings.meta_cost_margin_percent) || 0, 0);
    const metaCostAmount = Math.max(Number(metaAmount) || 0, 0);
    const metaCostLyd = metaCostAmount * exchangeRate;
    const customerChargeLyd = metaCostLyd * (1 + marginPercent / 100);
    const credits = customerChargeLyd > 0 ? Math.ceil(customerChargeLyd / creditValueLyd) : 0;

    return {
        credits,
        meta_cost_lyd: metaCostLyd,
        customer_charge_lyd: customerChargeLyd,
        credit_value_lyd: creditValueLyd,
        exchange_rate_to_lyd: exchangeRate,
        margin_percent: marginPercent,
    };
};

export const deductAccountBalances = (account = {}, credits = 0) => {
    let remaining = Math.max(toInteger(credits), 0);
    let planBalance = Math.max(toInteger(account.plan_balance_credits), 0);
    let walletBalance = Math.max(toInteger(account.wallet_balance_credits), 0);
    let creditUsed = Math.max(toInteger(account.credit_used_credits), 0);

    const planDebit = Math.min(planBalance, remaining);
    planBalance -= planDebit;
    remaining -= planDebit;

    const walletDebit = Math.min(walletBalance, remaining);
    walletBalance -= walletDebit;
    remaining -= walletDebit;

    creditUsed += remaining;
    return {
        plan_balance_credits: planBalance,
        wallet_balance_credits: walletBalance,
        credit_used_credits: creditUsed,
    };
};
