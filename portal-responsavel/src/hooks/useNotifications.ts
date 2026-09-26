import { useCallback, useEffect, useRef, useState } from 'react';
import {
  getNotificacoesDoAluno,
  getVapidPublicKey,
  marcarNotificacaoLida,
  ocultarNotificacao,
  subscribePush,
} from '../services/apiService';
import { socket } from '../services/socket';
import type { AuthUser, Notification } from '../types';

interface UseNotificationsOptions {
  authUser: AuthUser | null;
  activeId: string | null;
}

export function useNotifications({ authUser, activeId }: UseNotificationsOptions) {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [showNotifications, setShowNotifications] = useState(false);
  const [showNotificationsModal, setShowNotificationsModal] = useState(false);
  const [priorityNotification, setPriorityNotification] = useState<Notification | null>(null);

  useEffect(() => {
    if (!activeId) {
      setNotifications([]);
      return;
    }

    let isMounted = true;

    const loadNotifications = async () => {
      try {
        const data = await getNotificacoesDoAluno(activeId);
        if (isMounted) setNotifications(data);
      } catch {}
    };

    void loadNotifications();

    const pollTimer = setInterval(() => {
      void loadNotifications();
    }, 60000);

    return () => {
      isMounted = false;
      clearInterval(pollTimer);
    };
  }, [activeId]);

  // O socket é assinado uma vez por sessão; o aluno ativo muda por baixo.
  const activeIdRef = useRef(activeId);
  activeIdRef.current = activeId;

  useEffect(() => {
    if (!authUser) return;

    // O evento traz o documento cru (`lido` é array de ids, `destinatarios` é
    // o público inteiro) e não sabe qual filho está aberto. Em vez de inserir
    // o cru na lista, a lista é relida pelo endpoint do aluno ativo — o mesmo
    // filtro de escola e de público do carregamento normal — e o aviso só
    // aparece se for mesmo deste aluno.
    const handleNewNotification = async (data: {
      notification?: { id?: string; _id?: string };
    }) => {
      const alunoId = activeIdRef.current;
      const nova = data?.notification;
      if (!alunoId || !nova) return;
      try {
        const lista = await getNotificacoesDoAluno(alunoId);
        if (activeIdRef.current !== alunoId) return;
        setNotifications(lista);
        const chegou = lista.find((n) => n.id === nova.id || n.id === nova._id);
        if (chegou?.prioridade === 'alta') setPriorityNotification(chegou);
      } catch {}
    };

    socket.on('notification:new', handleNewNotification);
    return () => {
      socket.off('notification:new', handleNewNotification);
    };
  }, [authUser]);

  useEffect(() => {
    if (!authUser) return;

    const urlBase64ToUint8Array = (base64String: string) => {
      const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
      const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
      const rawData = window.atob(base64);
      const outputArray = new Uint8Array(rawData.length);
      for (let index = 0; index < rawData.length; index += 1) {
        outputArray[index] = rawData.charCodeAt(index);
      }
      return outputArray;
    };

    const initPush = async () => {
      if (!('serviceWorker' in navigator) || !('PushManager' in window) || !window.Notification)
        return;

      try {
        if (Notification.permission === 'denied') return;

        const keyData = await getVapidPublicKey();
        if (!keyData?.publicKey) return;

        if (Notification.permission !== 'granted') {
          const permission = await Notification.requestPermission();
          if (permission !== 'granted') return;
        }

        const registration = await navigator.serviceWorker.ready;
        let subscription = await registration.pushManager.getSubscription();

        if (!subscription) {
          subscription = await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(keyData.publicKey),
          });
        }

        await subscribePush(subscription);
      } catch (err) {
        console.warn('⚠️ [Push] Falha ao configurar Push no portal:', (err as Error).message);
      }
    };

    void initPush();
  }, [authUser]);

  const handleMarkAsRead = useCallback(
    async (id: string) => {
      if (!activeId) return;
      try {
        await marcarNotificacaoLida(id, activeId);
        setNotifications((prev) =>
          prev.map((notification) =>
            notification.id === id ? { ...notification, lido: true } : notification
          )
        );
      } catch (err) {
        console.error('Erro ao marcar notificação como lida:', err);
      }
    },
    [activeId]
  );

  const handleDeleteNotification = useCallback(
    async (id: string) => {
      if (!activeId) return;
      try {
        await ocultarNotificacao(id, activeId);
        setNotifications((prev) => prev.filter((notification) => notification.id !== id));
      } catch (err) {
        console.error('Erro ao ocultar notificação:', err);
      }
    },
    [activeId]
  );

  return {
    notifications,
    setNotifications,
    showNotifications,
    setShowNotifications,
    showNotificationsModal,
    setShowNotificationsModal,
    priorityNotification,
    setPriorityNotification,
    handleMarkAsRead,
    handleDeleteNotification,
  };
}
