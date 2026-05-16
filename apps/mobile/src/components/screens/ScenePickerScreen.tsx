import React, { useCallback, useEffect, useRef, useState } from 'react';
import { FlatList, SafeAreaView, StyleSheet, View } from 'react-native';
import { Button, Card, Text } from 'react-native-paper';

import type { DiscoveredHost, SceneRecord } from '@manga-ar/shared';

import { fetchScenes } from '../../services/hostApi';

type ScenePickerScreenProps = {
  host: DiscoveredHost;
  onBack: () => void;
  onSelectScene: (scene: SceneRecord) => void;
};

export function ScenePickerScreen({ host, onBack, onSelectScene }: ScenePickerScreenProps) {
  const [scenes, setScenes] = useState<SceneRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const loadRequestIdRef = useRef(0);

  const loadScenes = useCallback(
    async (cancelled?: () => boolean) => {
      const requestId = loadRequestIdRef.current + 1;
      loadRequestIdRef.current = requestId;

      const isStale = () => requestId !== loadRequestIdRef.current || cancelled?.() === true;

      setLoading(true);
      setError(null);

      try {
        const response = await fetchScenes({ address: host.address, port: host.httpPort });
        if (isStale()) {
          return;
        }
        setScenes(response.scenes);
      } catch {
        if (isStale()) {
          return;
        }
        setError('场景列表加载失败');
      } finally {
        if (!isStale()) {
          setLoading(false);
        }
      }
    },
    [host.address, host.httpPort]
  );

  useEffect(() => {
    let cancelled = false;
    void loadScenes(() => cancelled);

    return () => {
      cancelled = true;
    };
  }, [host.hostId, loadScenes]);

  const renderScene = useCallback(
    ({ item }: { item: SceneRecord }) => (
      <Card mode="contained" style={styles.sceneCard} onPress={() => onSelectScene(item)}>
        <Card.Title
          title={item.name}
          subtitle={`revision ${item.revision}`}
          titleNumberOfLines={1}
          subtitleNumberOfLines={1}
          titleStyle={styles.sceneTitle}
          subtitleStyle={styles.sceneSubtitle}
        />
      </Card>
    ),
    [onSelectScene]
  );

  const showEmptyScenes = !loading && !error && scenes.length === 0;
  const header = (
    <View style={styles.header}>
      <Button mode="outlined" onPress={onBack} style={styles.backButton} textColor="#fafafa">
        返回主机列表
      </Button>

      <Text variant="headlineMedium" style={styles.headline} numberOfLines={2}>
        {host.hostName}
      </Text>

      {error ? (
        <Text variant="bodyMedium" style={styles.errorText}>
          {error}
        </Text>
      ) : null}

      <Button
        mode="contained"
        loading={loading}
        disabled={loading}
        onPress={() => void loadScenes()}
        style={styles.refreshButton}
      >
        刷新场景
      </Button>

      {showEmptyScenes ? (
        <Text variant="bodyMedium" style={styles.emptyText}>
          该主机暂无可用场景
        </Text>
      ) : null}
    </View>
  );

  return (
    <SafeAreaView style={styles.container}>
      <FlatList
        contentContainerStyle={styles.sceneList}
        data={scenes}
        keyExtractor={(item) => item.sceneId}
        ListHeaderComponent={header}
        renderItem={renderScene}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#09090b',
  },
  header: {
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
  errorText: {
    marginTop: 12,
    color: '#fca5a5',
  },
  refreshButton: {
    marginTop: 20,
  },
  emptyText: {
    marginTop: 16,
    color: '#d4d4d8',
    lineHeight: 20,
  },
  sceneList: {
    paddingBottom: 24,
    gap: 12,
  },
  sceneCard: {
    marginHorizontal: 20,
    backgroundColor: '#18181b',
  },
  sceneTitle: {
    color: '#fafafa',
    fontWeight: '700',
  },
  sceneSubtitle: {
    color: '#a1a1aa',
  },
});
