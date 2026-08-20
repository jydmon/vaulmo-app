import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { api } from './api';

// Register this device for push (REM-08). Best-effort and never throws: requests
// permission, fetches the Expo push token, and hands it to the API. Delivery itself
// depends on FCM/APNs being configured in the Expo project — until then registration
// simply no-ops, and in-app notifications keep working.
let registered = false;

export async function registerForPush(): Promise<void> {
  if (registered || Platform.OS === 'web') return;
  try {
    const settings = await Notifications.getPermissionsAsync();
    let status = settings.status;
    if (status !== 'granted') {
      status = (await Notifications.requestPermissionsAsync()).status;
    }
    if (status !== 'granted') return;

    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'Default',
        importance: Notifications.AndroidImportance.DEFAULT,
      });
    }

    const projectId =
      (Constants.expoConfig?.extra as any)?.eas?.projectId ??
      (Constants as any)?.easConfig?.projectId;
    const tokenResp = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
    const token = tokenResp?.data;
    if (!token) return;

    await api.registerDevice(Platform.OS, token);
    registered = true;
  } catch {
    /* push is optional — never block the app on it */
  }
}
