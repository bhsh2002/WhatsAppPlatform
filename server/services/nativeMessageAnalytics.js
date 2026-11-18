// The ordinary owner dashboard and collaborative snapshot use the same native
// query. This is local message activity, never inventory or financial measures.
export const readNativeMessageAnalytics = ({ database, tenantId, phoneNumberId = null }) => {
    const filter=phoneNumberId ? "AND ((direction='incoming' AND recipient=?) OR (direction='outgoing' AND sender=?))" : '';
    const params=[tenantId,...(phoneNumberId ? [phoneNumberId,phoneNumberId] : [])];
    const totals=database.prepare(`SELECT COUNT(*) total_messages,
        SUM(CASE WHEN direction='outgoing' THEN 1 ELSE 0 END) sent_messages,
        SUM(CASE WHEN direction='incoming' THEN 1 ELSE 0 END) received_messages,
        SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) failed_messages FROM messages WHERE tenant_id=? ${filter}`).get(...params);
    return {totalMessages:Number(totals.total_messages)||0,sentMessages:Number(totals.sent_messages)||0,
        receivedMessages:Number(totals.received_messages)||0,failedMessages:Number(totals.failed_messages)||0,
        dailyBreakdown:database.prepare(`SELECT date(created_at) date,COUNT(*) total,
            SUM(CASE WHEN direction='outgoing' THEN 1 ELSE 0 END) sent,
            SUM(CASE WHEN direction='incoming' THEN 1 ELSE 0 END) received
            FROM messages WHERE tenant_id=? ${filter} AND created_at>=datetime('now','-30 days')
            GROUP BY date(created_at) ORDER BY date DESC`).all(...params),
        typeDistribution:database.prepare(`SELECT message_type,COUNT(*) count FROM messages WHERE tenant_id=? ${filter}
            GROUP BY message_type ORDER BY count DESC,message_type ASC`).all(...params)};
};
