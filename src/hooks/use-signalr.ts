
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import * as signalR from '@microsoft/signalr';

export const useSignalR = (hubUrl: string) => {
    const [connection, setConnection] = useState<signalR.HubConnection | null>(null);
    const connectionRef = useRef<signalR.HubConnection | null>(null);

    const startConnection = useCallback(async () => {
        if (!hubUrl) return;

        if (!connectionRef.current) {
            const conn = new signalR.HubConnectionBuilder()
                .withUrl(hubUrl)
                .withAutomaticReconnect()
                .build();
            connectionRef.current = conn;
            setConnection(conn);
        }

        const conn = connectionRef.current;
        if (!conn) return;

        if (conn.state === signalR.HubConnectionState.Connected || conn.state === signalR.HubConnectionState.Connecting) {
            return;
        }

        try {
            await conn.start();
        } catch {
            // caller can decide whether to retry
        }
    }, [hubUrl]);

    const stopConnection = useCallback(async () => {
        const conn = connectionRef.current;
        if (!conn) return;
        try {
            await conn.stop();
        } catch {
            // ignore
        }
    }, []);

    useEffect(() => {
        // Auto-start on mount when a hubUrl is provided
        startConnection();
        return () => {
            stopConnection();
        };
    }, [startConnection, stopConnection]);

    return { connection, startConnection, stopConnection };
};
