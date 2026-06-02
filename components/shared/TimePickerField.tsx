// Componente reutilizável de seleção de horário com DateTimePicker nativo.
// Android: dialog nativo sem Modal.
// iOS: spinner em Modal com botões Cancelar / OK.

import React, { useState } from 'react'
import {
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker'
import { colors } from '../../tokens/colors'
import { typography } from '../../tokens/typography'
import { spacing } from '../../tokens/spacing'

// ── Utilitário ────────────────────────────────────────────────────────────────

export function formatTimeBR(date: Date): string {
  const h = String(date.getHours()).padStart(2, '0')
  const m = String(date.getMinutes()).padStart(2, '0')
  return `${h}:${m}`
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface TimePickerFieldProps {
  value:        Date | null
  onChange:     (date: Date) => void
  label?:       string
  placeholder?: string
  minuteInterval?: 1 | 2 | 3 | 4 | 5 | 6 | 10 | 12 | 15 | 20 | 30
  error?:       string | null
  hint?:        string | null
}

// ── Componente ────────────────────────────────────────────────────────────────

export function TimePickerField({
  value,
  onChange,
  label,
  placeholder = 'Selecionar horário',
  minuteInterval,
  error,
  hint,
}: TimePickerFieldProps) {
  const [show, setShow]         = useState(false)
  const [tempDate, setTempDate] = useState<Date>(value ?? defaultTime())

  const handleChange = (event: DateTimePickerEvent, selected?: Date) => {
    if (Platform.OS === 'android') {
      setShow(false)
      if (event.type === 'set' && selected) onChange(selected)
    } else {
      if (selected) setTempDate(selected)
    }
  }

  const handleOpen = () => {
    setTempDate(value ?? defaultTime())
    setShow(true)
  }

  const borderColor = error
    ? colors.state.error
    : 'rgba(255,255,255,0.18)'

  return (
    <View style={s.wrapper}>
      {label ? <Text style={s.label}>{label}</Text> : null}

      <Pressable
        style={[s.row, { borderBottomColor: borderColor }]}
        onPress={handleOpen}
        accessibilityRole="button"
        accessibilityLabel={label}
      >
        <Text style={[s.valueText, !value && s.placeholder]}>
          {value ? formatTimeBR(value) : placeholder}
        </Text>
        <Text style={s.chevron}>▾</Text>
      </Pressable>

      {(error || hint) ? (
        <Text style={[s.helper, error ? s.helperError : s.helperHint]}>
          {error ?? hint}
        </Text>
      ) : null}

      {/* Android — dialog nativo */}
      {show && Platform.OS === 'android' && (
        <DateTimePicker
          value={tempDate}
          mode="time"
          display="default"
          onChange={handleChange}
          minuteInterval={minuteInterval}
          is24Hour
        />
      )}

      {/* iOS — spinner em Modal */}
      {Platform.OS === 'ios' && (
        <Modal visible={show} transparent animationType="slide">
          <View style={s.overlay}>
            <View style={s.sheet}>
              <View style={s.sheetHeader}>
                <TouchableOpacity onPress={() => setShow(false)} hitSlop={8}>
                  <Text style={s.cancelBtn}>Cancelar</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => { setShow(false); onChange(tempDate) }}
                  hitSlop={8}
                >
                  <Text style={s.confirmBtn}>OK</Text>
                </TouchableOpacity>
              </View>
              <DateTimePicker
                value={tempDate}
                mode="time"
                display="spinner"
                onChange={handleChange}
                minuteInterval={minuteInterval}
                style={s.spinner}
                textColor={colors.white[100]}
                locale="pt-BR"
                is24Hour
              />
            </View>
          </View>
        </Modal>
      )}
    </View>
  )
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function defaultTime(): Date {
  const d = new Date()
  d.setHours(20, 0, 0, 0)
  return d
}

// ── Styles ────────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  wrapper: {
    marginBottom: 18,
  },
  label: {
    fontSize: 10,
    color: 'rgba(255,255,255,0.42)',
    letterSpacing: typography.eyebrow.letterSpacing,
    textTransform: 'uppercase',
    fontFamily: typography.fontFamily.primary,
    marginBottom: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 0.5,
    paddingBottom: 6,
    paddingVertical: 4,
  },
  valueText: {
    flex: 1,
    fontSize: 16,
    color: colors.white[100],
    fontFamily: typography.fontFamily.primary,
    letterSpacing: -0.16,
  },
  placeholder: {
    color: 'rgba(255,255,255,0.28)',
  },
  chevron: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.35)',
    marginLeft: 8,
  },
  helper: {
    fontSize: 11,
    marginTop: 6,
    lineHeight: 15,
    fontFamily: typography.fontFamily.primary,
  },
  helperError: {
    color: colors.state.error,
  },
  helperHint: {
    color: 'rgba(255,255,255,0.38)',
  },

  // iOS Modal
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#1C1C1E',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingBottom: 32,
  },
  sheetHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: 14,
    borderBottomWidth: 0.5,
    borderBottomColor: 'rgba(255,255,255,0.1)',
  },
  cancelBtn: {
    fontSize: 16,
    fontFamily: typography.fontFamily.primary,
    color: 'rgba(255,255,255,0.55)',
  },
  confirmBtn: {
    fontSize: 16,
    fontWeight: '600',
    fontFamily: typography.fontFamily.primary,
    color: colors.white[100],
  },
  spinner: {
    height: 200,
  },
})
