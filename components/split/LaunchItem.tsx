// Design: /design/flows-split.jsx — launch feed inside SplitDetailScreen
// Progressive feed item for variable split; optional photo thumbnail

import { Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { Svg, Path } from 'react-native-svg'
import { useTranslation } from 'react-i18next'
import { SplitItem } from '../../store/split.store'
import { formatAlbers } from '../../utils/format'
import { colors, spaceSkins } from '../../tokens/colors'
import { spacing } from '../../tokens/spacing'
import { typography } from '../../tokens/typography'

// ─── Component ────────────────────────────────────────────────────────────────

interface Props {
  item: SplitItem
  /** @handle of who launched this item */
  launchedBy: string
  /** Pre-formatted relative time string, e.g. "2h atrás" */
  timeAgo: string
  onPhotoPress?: () => void
  showTopBorder?: boolean
}

export function LaunchItem({
  item,
  launchedBy,
  timeAgo,
  onPhotoPress,
  showTopBorder = true,
}: Props) {
  const { t } = useTranslation()

  const isRealUri =
    item.photoUri !== null &&
    (item.photoUri.startsWith('file://') ||
      item.photoUri.startsWith('content://') ||
      item.photoUri.startsWith('http'))

  return (
    <View style={[styles.container, showTopBorder && styles.topBorder]}>
      {/* Main row */}
      <View style={styles.mainRow}>
        {/* Teal "+" icon */}
        <View style={styles.iconWrap}>
          <Svg width={12} height={12} viewBox="0 0 12 12">
            <Path
              d="M2 6h8M6 2v8"
              stroke={spaceSkins.surf.accent}
              strokeWidth={1.4}
              strokeLinecap="round"
            />
          </Svg>
        </View>

        {/* Description + meta */}
        <View style={styles.descCol}>
          <Text style={styles.desc} numberOfLines={1}>{item.description}</Text>
          <Text style={styles.meta}>{launchedBy} · {timeAgo}</Text>
        </View>

        {/* Values */}
        <View style={styles.valueCol}>
          <Text style={styles.total}>{formatAlbers(item.totalValue)}</Text>
          <Text style={styles.perPerson}>
            {t('split.detalhe.eachSuffix')
              ? `${formatAlbers(item.perPersonValue)} ${t('split.detalhe.eachSuffix')}`
              : `${formatAlbers(item.perPersonValue)} cada`}
          </Text>
        </View>
      </View>

      {/* Optional photo thumbnail */}
      {item.photoUri !== null && (
        <TouchableOpacity
          onPress={onPhotoPress}
          activeOpacity={0.85}
          style={styles.photoWrap}
        >
          {isRealUri ? (
            <Image
              source={{ uri: item.photoUri }}
              style={styles.photo}
              resizeMode="cover"
              accessibilityLabel={item.description}
            />
          ) : (
            /* Mock placeholder — rendered when photoUri is a non-URI mock string */
            <ReceiptPlaceholder value={item.totalValue} desc={item.description} />
          )}
          {/* Zoom icon overlay */}
          <View style={styles.zoomBadge}>
            <Svg width={7} height={7} viewBox="0 0 8 8">
              <Path
                d="M3 1h4v4M5 3l-4 4"
                stroke={colors.white[100]}
                strokeWidth={1.1}
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
              />
            </Svg>
          </View>
        </TouchableOpacity>
      )}
    </View>
  )
}

// ─── Receipt placeholder (mock) ───────────────────────────────────────────────

function ReceiptPlaceholder({ value, desc }: { value: number; desc: string }) {
  const lines = [0, 1, 2, 3, 4, 5]
  return (
    <View style={receipt.root}>
      <View style={receipt.paper}>
        <Text style={receipt.title} numberOfLines={1}>
          {desc.toUpperCase().slice(0, 16)}
        </Text>
        <View style={receipt.divider} />
        {lines.map(i => (
          <View key={i} style={receipt.line} />
        ))}
        <View style={receipt.totalLine}>
          <Text style={receipt.totalLabel}>TOTAL</Text>
          <Text style={receipt.totalValue}>{formatAlbers(value)}</Text>
        </View>
      </View>
    </View>
  )
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    paddingVertical: 12,
  },
  topBorder: {
    borderTopWidth: 0.5,
    borderTopColor: 'rgba(255,255,255,0.05)',
  },

  // Main row
  mainRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  iconWrap: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(91,206,201,0.1)',
    borderWidth: 0.5,
    borderColor: 'rgba(91,206,201,0.25)',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },

  descCol: {
    flex: 1,
    minWidth: 0,
  },
  desc: {
    fontSize: 13.5,
    fontFamily: typography.fontFamily.primary,
    color: colors.white[100],
  },
  meta: {
    fontSize: 10.5,
    fontFamily: typography.fontFamily.primary,
    color: 'rgba(255,255,255,0.4)',
    marginTop: 2,
  },

  valueCol: {
    alignItems: 'flex-end',
    flexShrink: 0,
  },
  total: {
    fontSize: 13,
    fontWeight: typography.weight.bold,
    fontFamily: typography.fontFamily.primary,
    color: colors.white[100],
    fontVariant: ['tabular-nums'],
  },
  perPerson: {
    fontSize: 10,
    fontFamily: typography.fontFamily.primary,
    color: 'rgba(255,255,255,0.4)',
  },

  // Photo thumbnail — offset to align under description, past the icon
  photoWrap: {
    marginTop: spacing.sm,
    marginLeft: 40,
    width: 88,
    height: 64,
    borderRadius: spacing.radius.sm,
    overflow: 'hidden',
    borderWidth: 0.5,
    borderColor: 'rgba(255,255,255,0.12)',
    position: 'relative',
  },
  photo: {
    width: '100%',
    height: '100%',
  },
  zoomBadge: {
    position: 'absolute',
    bottom: 3,
    right: 4,
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
})

const receipt = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#f5f1e8',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 4,
  },
  paper: {
    width: '80%',
    backgroundColor: colors.white[100],
    borderWidth: 0.5,
    borderColor: '#d4cdb8',
    padding: 4,
    borderRadius: 2,
  },
  title: {
    fontSize: 5,
    fontWeight: typography.weight.bold,
    color: '#222',
    textAlign: 'center',
    fontFamily: 'monospace',
    marginBottom: 2,
  },
  divider: {
    height: 0.5,
    backgroundColor: '#aaa',
    marginBottom: 2,
  },
  line: {
    height: 2,
    backgroundColor: '#333',
    opacity: 0.6,
    marginBottom: 1,
    borderRadius: 1,
  },
  totalLine: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 2,
    borderTopWidth: 0.5,
    borderTopColor: '#222',
    paddingTop: 2,
  },
  totalLabel: {
    fontSize: 5,
    fontWeight: typography.weight.bold,
    color: '#000',
    fontFamily: 'monospace',
  },
  totalValue: {
    fontSize: 5,
    fontWeight: typography.weight.bold,
    color: '#000',
    fontFamily: 'monospace',
  },
})
