import { useCallback, useEffect, useRef, useState } from 'react';
import {
  getNotificacoesDoAluno,
  marcarNotificacaoLida,
  ocultarNotificacao,
} from '../services/apiService';
import { sincronizarPush } from '../services/pushService';
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

  // Com a permissão já concedida, mantém a inscrição do aparelho em dia (e a
  // renova se as chaves VAPID do servidor mudaram). O PEDIDO de permissão não
  // sai daqui: precisa de um toque — ver components/PushAtivacaoAviso.tsx.
  useEffect(() => {
    if (!authUser) return;
    void sincronizarPush();
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
