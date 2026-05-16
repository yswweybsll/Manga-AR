import React, { useEffect, useRef, useState } from 'react';
import { SafeAreaView, StyleSheet, View } from 'react-native';
import { Button, ProgressBar, Text } from 'react-native-paper';

import type { AssetRecord, DiscoveredHost, ModelAssetRef, SceneRecord, SceneResponse } from '@manga-ar/shared';

import { syncSceneAssets, type LocalAssetRecord } from '../../services/assetSyncService';
import { fetchScene, fetchSceneAssets } from '../../services/hostApi';

type AssetSyncScreenProps = {
  host: DiscoveredHost;
  scene: SceneRecord;
  onBack: () => void;
  onReady: (payload: {
    sceneResponse: SceneResponse;
    assetsById: Record<string, LocalAssetRecord>;
  }) => void;
};

function assetKey(ref: ModelAssetRef): string {
  return `${ref.assetId}@${ref.version}`;
}

function requireManifestAssets(sceneResponse: SceneResponse, manifestAssets: AssetRecord[]): AssetRecord[] {
  const manifestByKey = new Map(manifestAssets.map((asset) => [assetKey(asset), asset]));
  const requiredByKey = new Map<string, ModelAssetRef>();

  for (const ref of sceneResponse.scene.assetRefs) {
    requiredByKey.set(assetKey(ref), ref);
  }

  for (const instance of sceneResponse.document.instances) {
    requiredByKey.set(assetKey(instance.asset), instance.asset);
  }

  return [...requiredByKey.values()].map((ref) => {
    const asset = manifestByKey.get(assetKey(ref));
    if (!asset) {
      throw new Error(`资产清单缺少必需资产: ${ref.assetId}@${ref.version}`);
    }

    return asset;
  });
}

export function AssetSyncScreen({ host, scene, onBack, onReady }: AssetSyncScreenProps) {
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState('准备同步资产');
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(true);
  const [retryToken, setRetryToken] = useState(0);
  const onReadyRef = useRef(onReady);

  useEffect(() => {
    onReadyRef.current = onReady;
  }, [onReady]);

  useEffect(() => {
    let cancelled = false;

    async function syncAssets() {
      const endpoint = { address: host.address, port: host.httpPort };
      setSyncing(true);
      setProgress(0);
      setMessage('准备同步资产');
      setError(null);

      try {
        const sceneResponse = await fetchScene(endpoint, scene.sceneId);
        if (cancelled) {
          return;
        }

        const manifest = await fetchSceneAssets(endpoint, scene.sceneId);
        if (cancelled) {
          return;
        }

        const requiredAssets = requireManifestAssets(sceneResponse, manifest.assets);
        setMessage(`需要同步 ${requiredAssets.length} 个资产`);
        if (requiredAssets.length === 0) {
          setProgress(1);
          setMessage('无需同步资产');
          setSyncing(false);
          onReadyRef.current({ sceneResponse, assetsById: {} });
          return;
        }

        const assetsById = await syncSceneAssets(endpoint, requiredAssets, (completed, total) => {
          if (cancelled) {
            return;
          }
          setProgress(total === 0 ? 1 : completed / total);
          setMessage(`已同步 ${completed}/${total}`);
        });
        if (cancelled) {
          return;
        }

        setProgress(1);
        setMessage(`已同步 ${requiredAssets.length}/${requiredAssets.length}`);
        setSyncing(false);
        onReadyRef.current({ sceneResponse, assetsById });
      } catch {
        if (cancelled) {
          return;
        }
        setError('资产同步失败');
        setSyncing(false);
      }
    }

    void syncAssets();

    return () => {
      cancelled = true;
    };
  }, [host.address, host.hostId, host.httpPort, retryToken, scene.sceneId]);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <Button
          mode="outlined"
          onPress={onBack}
          disabled={syncing}
          style={styles.backButton}
          textColor="#fafafa"
        >
          返回场景列表
        </Button>

        <Text variant="headlineMedium" style={styles.headline}>
          同步资产
        </Text>
        <Text variant="titleMedium" style={styles.sceneName} numberOfLines={2}>
          {scene.name}
        </Text>

        <ProgressBar progress={progress} color="#60a5fa" style={styles.progressBar} />

        <Text variant="bodyMedium" style={styles.messageText}>
          {message}
        </Text>

        {error ? (
          <View style={styles.errorGroup}>
            <Text variant="bodyMedium" style={styles.errorText}>
              {error}
            </Text>
            <Button
              mode="contained"
              loading={syncing}
              disabled={syncing}
              onPress={() => setRetryToken((value) => value + 1)}
            >
              重试
            </Button>
          </View>
        ) : null}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#09090b',
  },
  content: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 20,
  },
  backButton: {
    alignSelf: 'flex-start',
    borderColor: '#3f3f46',
  },
  headline: {
    marginTop: 20,
    color: '#fafafa',
    fontWeight: '700',
  },
  sceneName: {
    marginTop: 8,
    color: '#d4d4d8',
  },
  progressBar: {
    height: 8,
    marginTop: 24,
    borderRadius: 4,
    backgroundColor: '#27272a',
  },
  messageText: {
    marginTop: 16,
    color: '#fafafa',
    lineHeight: 20,
  },
  errorGroup: {
    gap: 12,
    marginTop: 16,
  },
  errorText: {
    color: '#fca5a5',
  },
});
