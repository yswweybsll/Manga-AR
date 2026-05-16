import { StatusBar } from 'expo-status-bar';
import React, { useCallback, useEffect, useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';
import {
  MD3DarkTheme,
  PaperProvider,
  type MD3Theme,
} from 'react-native-paper';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { fetchModels } from './src/api/models';
import { ARPlacementScreen } from './src/components/screens/ARPlacementScreen';
import { ModelLibraryScreen } from './src/components/screens/ModelLibraryScreen';
import { cacheModelAsset } from './src/services/modelCache';
import type { CachedModelAsset, RemoteModel } from './src/types/model';

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

export default function App() {
  const [models, setModels] = useState<RemoteModel[]>([]);
  const [loadingModels, setLoadingModels] = useState(true);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [preparingModelId, setPreparingModelId] = useState<string | null>(null);
  const [selectedModel, setSelectedModel] = useState<CachedModelAsset | null>(null);

  const loadModels = useCallback(async () => {
    setLoadingModels(true);
    setModelsError(null);

    try {
      const nextModels = await fetchModels();
      setModels(nextModels);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : '未知错误，请稍后重试。';
      setModelsError(message);
    } finally {
      setLoadingModels(false);
    }
  }, []);

  useEffect(() => {
    void loadModels();
  }, [loadModels]);

  const handleSelectModel = useCallback(async (model: RemoteModel) => {
    setPreparingModelId(model.id);

    try {
      const cachedModel = await cacheModelAsset(model);
      setSelectedModel(cachedModel);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : '模型下载失败，请稍后重试。';
      Alert.alert('模型加载失败', message);
    } finally {
      setPreparingModelId(null);
    }
  }, []);

  const handleBackToLibrary = useCallback(() => {
    setSelectedModel(null);
  }, []);

  return (
    <SafeAreaProvider>
      <PaperProvider theme={appTheme}>
        <View style={styles.container}>
          <StatusBar style="light" />

          {selectedModel ? (
            <ARPlacementScreen
              initialModel={selectedModel}
              availableModels={models}
              onBack={handleBackToLibrary}
            />
          ) : (
            <ModelLibraryScreen
              models={models}
              loading={loadingModels}
              error={modelsError}
              preparingModelId={preparingModelId}
              onRetry={loadModels}
              onSelectModel={handleSelectModel}
            />
          )}
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
});
