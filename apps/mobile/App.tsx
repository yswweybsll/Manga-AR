import { StatusBar } from 'expo-status-bar';
import React, { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import {
  Button,
  MD3DarkTheme,
  PaperProvider,
  Text,
  type MD3Theme,
} from 'react-native-paper';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import type { DiscoveredHost, SceneRecord, SceneResponse } from '@manga-ar/shared';

import { AssetSyncScreen } from './src/components/screens/AssetSyncScreen';
import { HostDiscoveryScreen } from './src/components/screens/HostDiscoveryScreen';
import { ScenePickerScreen } from './src/components/screens/ScenePickerScreen';
import type { LocalAssetRecord } from './src/services/assetSyncService';

const appTheme: MD3Theme = {
  ...MD3DarkTheme,
  roundness: 3,
  colors: {
    ...MD3DarkTheme.colors,
    primary: '#7dd3fc',
    secondary: '#c4b5fd',
    tertiary: '#fda4af',
    background: '#09090b',
    surface: '#111318',
    surfaceVariant: '#1f2430',
    outline: '#3f3f46',
  },
};

type JoinedScenePayload = {
  sceneResponse: SceneResponse;
  assetsById: Record<string, LocalAssetRecord>;
};

export default function App() {
  const [host, setHost] = useState<DiscoveredHost | null>(null);
  const [scene, setScene] = useState<SceneRecord | null>(null);
  const [joinedScene, setJoinedScene] = useState<JoinedScenePayload | null>(null);

  const handleSelectHost = useCallback((nextHost: DiscoveredHost) => {
    setHost(nextHost);
    setScene(null);
    setJoinedScene(null);
  }, []);

  const handleBackToHosts = useCallback(() => {
    setHost(null);
    setScene(null);
    setJoinedScene(null);
  }, []);

  const handleSelectScene = useCallback((nextScene: SceneRecord) => {
    setScene(nextScene);
    setJoinedScene(null);
  }, []);

  const handleBackToScenes = useCallback(() => {
    setScene(null);
    setJoinedScene(null);
  }, []);

  const handleJoinedSceneReady = useCallback((payload: JoinedScenePayload) => {
    setJoinedScene(payload);
  }, []);

  return (
    <SafeAreaProvider>
      <PaperProvider theme={appTheme}>
        <View style={styles.container}>
          <StatusBar style="light" />

          {!host ? (
            <HostDiscoveryScreen onSelectHost={handleSelectHost} />
          ) : null}

          {host && !scene ? (
            <ScenePickerScreen
              host={host}
              onBack={handleBackToHosts}
              onSelectScene={handleSelectScene}
            />
          ) : null}

          {host && scene && !joinedScene ? (
            <AssetSyncScreen
              host={host}
              scene={scene}
              onBack={handleBackToScenes}
              onReady={handleJoinedSceneReady}
            />
          ) : null}

          {joinedScene ? (
            <View style={styles.readyContainer}>
              <Text variant="headlineMedium" style={styles.readyTitle}>
                共享场景已同步
              </Text>
              <Text variant="titleMedium" style={styles.readySceneName} numberOfLines={2}>
                {joinedScene.sceneResponse.scene.name}
              </Text>
              <Text variant="bodyMedium" style={styles.readyMeta}>
                revision {joinedScene.sceneResponse.scene.revision}
              </Text>
              <Text variant="bodyMedium" style={styles.readyMeta}>
                已同步资产：{Object.keys(joinedScene.assetsById).length}
              </Text>
              <Text variant="bodyMedium" style={styles.readyDescription}>
                AR 场景将在下一阶段接入。
              </Text>
              <Button mode="contained" onPress={handleBackToScenes} style={styles.readyButton}>
                返回场景列表
              </Button>
            </View>
          ) : null}
        </View>
      </PaperProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#09090b',
  },
  readyContainer: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  readyTitle: {
    color: '#fafafa',
    fontWeight: '700',
  },
  readySceneName: {
    marginTop: 12,
    color: '#d4d4d8',
    fontWeight: '700',
  },
  readyMeta: {
    marginTop: 8,
    color: '#a1a1aa',
  },
  readyDescription: {
    marginTop: 20,
    color: '#d4d4d8',
    lineHeight: 20,
  },
  readyButton: {
    marginTop: 24,
  },
});
