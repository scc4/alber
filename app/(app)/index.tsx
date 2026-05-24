import { StyleSheet, Text, View } from 'react-native'
import { colors } from '../../tokens/colors'
import { typography } from '../../tokens/typography'

// Placeholder — implementado no Sprint 2
export default function HomeScreen() {
  return (
    <View style={styles.root}>
      <Text style={styles.text}>Home — Sprint 2</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.black[100], alignItems: 'center', justifyContent: 'center' },
  text: { color: colors.white[100], fontSize: typography.size.body.fontSize },
})
