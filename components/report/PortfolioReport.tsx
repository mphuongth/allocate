import { Document, Page, View, Text, StyleSheet, Font } from '@react-pdf/renderer'
import path from 'path'
import type { DashboardData } from '@/app/assets/DashboardClient'
import { fmt, fmtPct } from '@/lib/formatters'

Font.register({
  family: 'Roboto',
  fonts: [
    { src: path.join(process.cwd(), 'public/fonts/Roboto-Regular.ttf'), fontWeight: 'normal' },
    { src: path.join(process.cwd(), 'public/fonts/Roboto-Bold.ttf'), fontWeight: 'bold' },
  ],
})

const styles = StyleSheet.create({
  page: { fontFamily: 'Roboto', fontWeight: 'normal', fontSize: 10, padding: 40, color: '#1a1a1a' },
  header: { marginBottom: 24 },
  title: { fontSize: 18, fontWeight: 'bold', marginBottom: 4 },
  subtitle: { fontSize: 10, color: '#6b7280' },
  section: { marginBottom: 20 },
  sectionTitle: { fontSize: 12, fontWeight: 'bold', marginBottom: 8, paddingBottom: 4, borderBottomWidth: 1, borderBottomColor: '#e5e7eb' },
  row: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 5 },
  label: { color: '#6b7280' },
  value: { fontWeight: 'bold' },
  positive: { color: '#16a34a' },
  negative: { color: '#dc2626' },
  goalCard: { padding: 10, marginBottom: 8, backgroundColor: '#f9fafb', borderRadius: 4 },
  goalName: { fontSize: 11, fontWeight: 'bold', marginBottom: 6 },
  indent: { paddingLeft: 8 },
  footer: { position: 'absolute', bottom: 30, left: 40, right: 40, textAlign: 'center', color: '#9ca3af', fontSize: 8 },
})

function ProfitText({ value, formatted }: { value: number; formatted: string }) {
  return <Text style={value >= 0 ? styles.positive : styles.negative}>{formatted}</Text>
}

function LabelRow({ label, value, profitValue }: { label: string; value: string; profitValue?: number }) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      {profitValue !== undefined
        ? <ProfitText value={profitValue} formatted={value} />
        : <Text style={styles.value}>{value}</Text>
      }
    </View>
  )
}

export function PortfolioReport({ data }: { data: DashboardData }) {
  const { netWorth, goals, byType } = data
  const generatedDate = new Date().toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' })

  const mutualFundsTotal = [
    ...data.goals.flatMap((g) => g.funds),
    ...data.unallocated.funds,
  ].reduce((sum, f) => sum + f.currentValue, 0)

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>Allocate — Báo cáo danh mục</Text>
          <Text style={styles.subtitle}>Ngày tạo: {generatedDate}</Text>
        </View>

        {/* Net Worth Summary */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Tổng quan tài sản</Text>
          <LabelRow label="Tổng đầu tư" value={fmt(netWorth.totalInvested)} />
          <LabelRow label="Giá trị hiện tại" value={fmt(netWorth.currentValue)} />
          <LabelRow
            label="Lãi / Lỗ"
            value={`${netWorth.overallProfitLoss >= 0 ? '+' : ''}${fmt(netWorth.overallProfitLoss)} (${fmtPct(netWorth.overallProfitLossPercentage)})`}
            profitValue={netWorth.overallProfitLoss}
          />
        </View>

        {/* Asset Breakdown */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Phân bổ tài sản</Text>
          {mutualFundsTotal > 0 && <LabelRow label="Quỹ đầu tư" value={fmt(mutualFundsTotal)} />}
          {byType.bank > 0 && <LabelRow label="Tiền gửi ngân hàng" value={fmt(byType.bank)} />}
          {byType.gold > 0 && <LabelRow label="Vàng" value={fmt(byType.gold)} />}
          {byType.stock > 0 && <LabelRow label="Cổ phiếu" value={fmt(byType.stock)} />}
          {mutualFundsTotal === 0 && byType.bank === 0 && byType.gold === 0 && byType.stock === 0 && (
            <Text style={styles.label}>Chưa có tài sản nào</Text>
          )}
        </View>

        {/* Savings Goals */}
        {goals.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Mục tiêu tiết kiệm</Text>
            {goals.map((goal) => (
              <View key={goal.goalId} style={styles.goalCard}>
                <Text style={styles.goalName}>{goal.goalName}</Text>
                <View style={styles.indent}>
                  <LabelRow label="Đã đầu tư" value={fmt(goal.totalInvested)} />
                  <LabelRow label="Giá trị hiện tại" value={fmt(goal.currentValue)} />
                  <LabelRow
                    label="Lãi / Lỗ"
                    value={`${goal.profitLoss >= 0 ? '+' : ''}${fmt(goal.profitLoss)} (${fmtPct(goal.profitLossPercentage)})`}
                    profitValue={goal.profitLoss}
                  />
                  {goal.targetAmount != null && goal.progressPercentage != null ? (
                    <LabelRow label="Mục tiêu" value={`${fmt(goal.targetAmount)} — ${goal.progressPercentage.toFixed(1)}% hoàn thành`} />
                  ) : (
                    <LabelRow label="Mục tiêu" value="Không có mục tiêu" />
                  )}
                </View>
              </View>
            ))}
          </View>
        )}

        <Text style={styles.footer}>Báo cáo được tạo bởi Allocate · {generatedDate}</Text>
      </Page>
    </Document>
  )
}
