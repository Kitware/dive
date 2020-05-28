declare module '@girder/components/src/utils/notifications' {
  export default class NotificationBus extends Vue {
    connect: () => void;

    disconnect: () => void;

    connected: boolean;
  }
}
