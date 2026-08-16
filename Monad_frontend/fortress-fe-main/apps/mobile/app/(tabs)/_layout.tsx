import { Tabs } from "expo-router";
import { PromptTabIcon, StrategiesTabIcon, ProfileTabIcon } from "@/components/TabIcons";
import { AppTabBar } from "@/components/AppTabBar";
import { colors } from "@/lib/theme";

export default function TabsLayout() {
  return (
    <Tabs
      tabBar={(props) => <AppTabBar {...props} />}
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: colors.bg },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{ title: "Prompt", tabBarIcon: ({ color, focused }) => <PromptTabIcon color={color as string} focused={focused} /> }}
      />
      <Tabs.Screen
        name="strategies"
        options={{ title: "Strategies", tabBarIcon: ({ color, focused }) => <StrategiesTabIcon color={color as string} focused={focused} /> }}
      />
      <Tabs.Screen
        name="profile"
        options={{ title: "Profile", tabBarIcon: ({ color, focused }) => <ProfileTabIcon color={color as string} focused={focused} /> }}
      />
    </Tabs>
  );
}
