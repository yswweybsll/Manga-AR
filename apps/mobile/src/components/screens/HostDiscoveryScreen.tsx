import React, { useCallback, useState } from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  SafeAreaView,
  StyleSheet,
  View,
} from 'react-native';
import { Button, Card, HelperText, Text, TextInput } from 'react-native-paper';

import type { DiscoveredHost } from '@manga-ar/shared';

import { createDiscoveryService } from '../../services/discoveryService';

type HostDiscoveryScreenProps = {
  onSelectHost: (host: DiscoveredHost) => void;
};

const discoveryService = createDiscoveryService();

function parsePort(value: string): number | null {
  if (!/^\d+$/.test(value.trim())) {
    return null;
  }

  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return null;
  }

  return port;
}

export function HostDiscoveryScreen({ onSelectHost }: HostDiscoveryScreenProps) {
  const [hosts, setHosts] = useState<DiscoveredHost[]>([]);
  const [manualAddress, setManualAddress] = useState('127.0.0.1');
  const [manualPort, setManualPort] = useState('3001');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);
  const [addressError, setAddressError] = useState(false);
  const [portError, setPortError] = useState(false);

  const discoverHosts = useCallback(async () => {
    setLoading(true);
    setError(null);
    setHasSearched(true);

    try {
      const discoveredHosts = await discoveryService.discover();
      setHosts(discoveredHosts);
    } catch {
      setError('发现主机失败');
    } finally {
      setLoading(false);
    }
  }, []);

  const connectManualHost = useCallback(async () => {
    const address = manualAddress.trim();
    const port = parsePort(manualPort);
    const nextAddressError = address.length === 0;
    const nextPortError = port === null;

    setAddressError(nextAddressError);
    setPortError(nextPortError);

    if (nextAddressError || nextPortError) {
      setError(nextAddressError ? '电脑 IP 不能为空' : '端口格式不正确');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const host = await discoveryService.rememberManualHost({ address, port });
      setLoading(false);
      onSelectHost(host);
      return;
    } catch {
      setError('连接主机失败');
      setLoading(false);
    }
  }, [manualAddress, manualPort, onSelectHost]);

  const renderHost = useCallback(
    ({ item }: { item: DiscoveredHost }) => (
      <Card mode="contained" style={styles.hostCard} onPress={() => onSelectHost(item)}>
        <Card.Title
          title={item.hostName}
          subtitle={`${item.address}:${item.httpPort}`}
          titleStyle={styles.hostTitle}
          subtitleStyle={styles.hostSubtitle}
        />
      </Card>
    ),
    [onSelectHost]
  );

  const showEmptyDiscovery = hasSearched && !loading && !error && hosts.length === 0;
  const header = (
    <View style={styles.header}>
      <Text variant="headlineMedium" style={styles.headline}>
        选择 Studio 主机
      </Text>

      <Button
        mode="contained"
        loading={loading}
        disabled={loading}
        onPress={discoverHosts}
        style={styles.searchButton}
      >
        搜索局域网主机
      </Button>

      {error ? (
        <Text variant="bodyMedium" style={styles.errorText}>
          {error}
        </Text>
      ) : null}

      <Card mode="contained" style={styles.manualCard}>
        <Card.Title title="手动连接" titleStyle={styles.manualTitle} />
        <Card.Content>
          <View style={styles.manualFields}>
            <TextInput
              mode="outlined"
              label="电脑 IP"
              value={manualAddress}
              onChangeText={(value) => {
                setManualAddress(value);
                setAddressError(false);
              }}
              autoCapitalize="none"
              autoCorrect={false}
              error={addressError}
            />
            {addressError ? (
              <HelperText type="error" visible={addressError} style={styles.helperText}>
                电脑 IP 不能为空
              </HelperText>
            ) : null}
            <TextInput
              mode="outlined"
              label="端口"
              value={manualPort}
              onChangeText={(value) => {
                setManualPort(value);
                setPortError(false);
              }}
              keyboardType="number-pad"
              error={portError}
            />
            {portError ? (
              <HelperText type="error" visible={portError} style={styles.helperText}>
                端口格式不正确
              </HelperText>
            ) : null}
            <Button mode="contained" loading={loading} disabled={loading} onPress={connectManualHost}>
              连接
            </Button>
          </View>
        </Card.Content>
      </Card>

      {showEmptyDiscovery ? (
        <Text variant="bodyMedium" style={styles.emptyText}>
          未发现主机，请确认 Studio 已启动或手动输入 IP
        </Text>
      ) : null}
    </View>
  );

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.keyboardAvoidingView}
      >
        <FlatList
          contentContainerStyle={styles.hostList}
          data={hosts}
          keyExtractor={(item) => `${item.hostId}:${item.address}:${item.httpPort}`}
          ListHeaderComponent={header}
          keyboardShouldPersistTaps="handled"
          renderItem={renderHost}
        />
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#09090b',
  },
  keyboardAvoidingView: {
    flex: 1,
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: 20,
  },
  headline: {
    color: '#fafafa',
    fontWeight: '700',
  },
  searchButton: {
    marginTop: 20,
  },
  errorText: {
    marginTop: 12,
    color: '#fca5a5',
  },
  helperText: {
    paddingHorizontal: 0,
  },
  emptyText: {
    marginTop: 16,
    color: '#d4d4d8',
    lineHeight: 20,
  },
  manualCard: {
    marginTop: 16,
    backgroundColor: '#18181b',
  },
  manualTitle: {
    color: '#fafafa',
    fontWeight: '700',
  },
  manualFields: {
    gap: 12,
    paddingBottom: 4,
  },
  hostList: {
    paddingBottom: 24,
    gap: 12,
  },
  hostCard: {
    marginHorizontal: 20,
    backgroundColor: '#18181b',
  },
  hostTitle: {
    color: '#fafafa',
    fontWeight: '700',
  },
  hostSubtitle: {
    color: '#a1a1aa',
  },
});
