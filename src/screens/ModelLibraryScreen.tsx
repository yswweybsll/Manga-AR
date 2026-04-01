import React from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import type { RemoteModel } from '../types/model';

type ModelLibraryScreenProps = {
  models: RemoteModel[];
  loading: boolean;
  error: string | null;
  preparingModelId: string | null;
  onRetry: () => void;
  onSelectModel: (model: RemoteModel) => void;
};

export function ModelLibraryScreen({
  models,
  loading,
  error,
  preparingModelId,
  onRetry,
  onSelectModel,
}: ModelLibraryScreenProps) {
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Manga AR</Text>
        <Text style={styles.subtitle}>
          第一步：选择一个模型并进入 AR 摆放流程。
        </Text>
      </View>

      {loading ? (
        <View style={styles.centerState}>
          <ActivityIndicator size="large" color="#7c3aed" />
          <Text style={styles.stateText}>正在加载模型列表...</Text>
        </View>
      ) : null}

      {!loading && error ? (
        <View style={styles.centerState}>
          <Text style={styles.errorTitle}>模型列表加载失败</Text>
          <Text style={styles.errorText}>{error}</Text>
          <Pressable style={styles.retryButton} onPress={onRetry}>
            <Text style={styles.retryButtonText}>重新加载</Text>
          </Pressable>
        </View>
      ) : null}

      {!loading && !error ? (
        <FlatList
          contentContainerStyle={styles.listContent}
          data={models}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => {
            const preparing = preparingModelId === item.id;

            return (
              <View style={styles.card}>
                <View style={styles.preview}>
                  {item.thumbnailUrl ? (
                    <Image source={{ uri: item.thumbnailUrl }} style={styles.previewImage} />
                  ) : (
                    <Text style={styles.previewFallback}>
                      {item.name.slice(0, 1).toUpperCase()}
                    </Text>
                  )}
                </View>

                <View style={styles.cardBody}>
                  <Text style={styles.modelName}>{item.name}</Text>
                  <Text style={styles.modelMeta}>
                    格式：{item.format} · 默认缩放：{item.defaultScale ?? 1}
                  </Text>
                  <Text style={styles.modelMeta}>
                    模型地址：{item.modelUrl}
                  </Text>

                  <Pressable
                    disabled={preparing}
                    onPress={() => onSelectModel(item)}
                    style={[styles.selectButton, preparing ? styles.buttonDisabled : null]}
                  >
                    {preparing ? (
                      <ActivityIndicator color="#ffffff" />
                    ) : (
                      <Text style={styles.selectButtonText}>进入 AR 摆放</Text>
                    )}
                  </Pressable>
                </View>
              </View>
            );
          }}
          ListEmptyComponent={
            <View style={styles.centerState}>
              <Text style={styles.stateText}>当前没有可用模型。</Text>
            </View>
          }
        />
      ) : null}
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
    paddingTop: 16,
    paddingBottom: 12,
  },
  title: {
    color: '#fafafa',
    fontSize: 28,
    fontWeight: '700',
  },
  subtitle: {
    marginTop: 8,
    color: '#a1a1aa',
    fontSize: 15,
    lineHeight: 22,
  },
  listContent: {
    paddingHorizontal: 16,
    paddingBottom: 24,
    gap: 12,
  },
  card: {
    flexDirection: 'row',
    gap: 14,
    padding: 14,
    borderRadius: 18,
    backgroundColor: '#18181b',
    borderWidth: 1,
    borderColor: '#27272a',
  },
  preview: {
    width: 88,
    height: 88,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#27272a',
    overflow: 'hidden',
  },
  previewImage: {
    width: '100%',
    height: '100%',
  },
  previewFallback: {
    color: '#e4e4e7',
    fontSize: 28,
    fontWeight: '700',
  },
  cardBody: {
    flex: 1,
  },
  modelName: {
    color: '#fafafa',
    fontSize: 18,
    fontWeight: '700',
  },
  modelMeta: {
    marginTop: 6,
    color: '#a1a1aa',
    fontSize: 13,
    lineHeight: 18,
  },
  selectButton: {
    marginTop: 12,
    minHeight: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#7c3aed',
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  selectButtonText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '700',
  },
  centerState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  stateText: {
    marginTop: 12,
    color: '#d4d4d8',
    fontSize: 15,
    textAlign: 'center',
  },
  errorTitle: {
    color: '#fafafa',
    fontSize: 18,
    fontWeight: '700',
  },
  errorText: {
    marginTop: 10,
    color: '#fca5a5',
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
  retryButton: {
    marginTop: 16,
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: '#7c3aed',
  },
  retryButtonText: {
    color: '#ffffff',
    fontWeight: '700',
  },
});
