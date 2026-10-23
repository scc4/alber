import React, { createContext, useContext } from 'react'
import { useColorScheme } from 'react-native'
import { foodThemes, FoodTheme, FoodThemeName } from '../../tokens/food'

const FoodThemeContext = createContext<FoodThemeName | null>(null)

interface FoodThemeProviderProps {
  name?: FoodThemeName
  children: React.ReactNode
}

/** Força um tema; sem `name`, segue o sistema. O app Alber é escuro, então o padrão é dark. */
export function FoodThemeProvider({ name, children }: FoodThemeProviderProps) {
  return <FoodThemeContext.Provider value={name ?? null}>{children}</FoodThemeContext.Provider>
}

export function useFoodTheme(): FoodTheme {
  const forced = useContext(FoodThemeContext)
  const system = useColorScheme()
  const name: FoodThemeName = forced ?? (system === 'light' ? 'light' : 'dark')
  return foodThemes[name]
}
