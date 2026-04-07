import hashlib
import os
import queue
import threading
import time

import paho.mqtt.client as mqtt


class Worker(threading.Thread):
    SUBSCRIBE = None
    RUN_DELAY = 0
    UPDATE_INTERVAL = 60 * 30
    NAME = 'Worker'

    def __init__(self):
        super().__init__()
        self._q = queue.Queue()
        self.work = False
        self._sender = None

    def _log(self, msg: str):
        print('{}: {}'.format(self.NAME, msg))

    def start(self) -> None:
        self.work = True
        super().start()

    def join(self, timeout=30) -> None:
        if self.work:
            self.work = False
            self._q.put_nowait('join')
            super().join(timeout)
            self._sender = None

    def mqtt_new_msg(self, topic: str, msg: str):
        self._q.put_nowait([topic, msg])

    def mqtt_connect(self):
        self._q.put_nowait('connect')

    def mqtt_set_sender(self, sender: callable):
        self._sender = sender

    def _mqtt_send_data(self, topic: str, msg: str):
        if self._sender:
            self._sender(topic, msg)

    def run(self) -> None:
        time.sleep(self.RUN_DELAY)
        while self.work:
            try:
                data = self._q.get(block=True, timeout=self.UPDATE_INTERVAL)
            except queue.Empty:
                data = [None, None]
            if data is None:
                continue
            elif isinstance(data, list):
                self._loop(*data)
            elif data == 'join':
                return
            elif data == 'connect':
                self._has_connected()
            else:
                self._log('Wrong data {}'.format(data))
                raise Exception

    def _has_connected(self):
        pass

    def _loop(self, topic: str or None, msg: str or None):
        pass


class MQTTManager(threading.Thread):
    NAME = 'MQTTManager'

    def __init__(self, credentials: dict, workers: list[Worker]):
        super().__init__()
        self.credentials = credentials
        self._workers = dict()
        self._q = queue.Queue()
        self.wait = threading.Event()
        for worker in workers:
            if worker.SUBSCRIBE:
                if isinstance(worker.SUBSCRIBE, str):
                    topics = [worker.SUBSCRIBE]
                elif isinstance(worker.SUBSCRIBE, (list, tuple)):
                    topics = worker.SUBSCRIBE
                else:
                    self._log('{} has wrong SUBSCRIBE type, ignore'.format(worker.NAME))
                    continue
                self._log('Add {}'.format(worker.NAME))
                worker.mqtt_set_sender(self.send_msg)
                for topic in topics:
                    if topic not in self._workers:
                        self._workers[topic] = []
                    self._workers[topic].append(worker)

        self.unique_id = 'mqtt_bridge_helper_' + hashlib.md5(os.urandom(6)).hexdigest()[:6]
        self.work = False
        self.conn = mqtt.Client(
            callback_api_version=mqtt.CallbackAPIVersion.VERSION2, client_id=self.unique_id, clean_session=False
        )
        self.conn.username_pw_set(username=self.credentials['username'], password=self.credentials['password'])
        self.conn.reconnect_delay_set(max_delay=600)
        self.conn.on_connect = self._on_connect
        self.conn.on_message = self._on_message
        self.conn.on_disconnect = self._on_disconnect

    def send_msg(self, topic: str, msg: str):
        self._q.put_nowait([topic, msg])

    def _log(self, msg: str):
        print('{}: {}'.format(self.NAME, msg))

    def start(self) -> None:
        self.work = True
        super().start()

    def join(self, timeout=30) -> None:
        if self.work:
            self.work = False
            self.wait.set()
            self._q.put_nowait(None)
            self.conn.loop_stop()
            self.conn.disconnect()
            super().join(timeout)

    def _on_connect(self, client, userdata, flags, reason_code, properties):
        if reason_code > 0:
            self._log(f"on_connect error: {reason_code}")
            return
        subscribes = 0
        for topic in self._workers:
            self.conn.subscribe(topic)
            subscribes += 1
            for worker in self._workers[topic]:
                worker.mqtt_connect()
        self._log('Connected to mqtt {}:{}, S:{}'.format(self.credentials['ip'], self.credentials['port'], subscribes))

    def _on_message(self, _, __, message: mqtt.MQTTMessage):
        try:
            topic = message.topic
            msg = message.payload.decode("utf-8")
            if topic in self._workers:
                for worker in self._workers[topic]:
                    worker.mqtt_new_msg(topic, msg)
            else:
                self._log('Got message from unregistered topic, WTF?: {}'.format(topic))
        except Exception as e:
            self._log('on_message error: {}'.format(e))

    def _on_disconnect(self, client, userdata, flags, reason_code, properties):
        if reason_code > 0:
            self._log('MQTT Disconnected, reconnecting. rc: {}'.format(reason_code))
            try:
                self.conn.reconnect()
            except ConnectionError as e:
                self._log('reconnect error: {}'.format(e))

    def _first_connect(self):
        wait = 30
        while wait and self.work:
            try:
                self.conn.connect(host=self.credentials['ip'], port=self.credentials['port'])
            except Exception as e:
                self._log('Connecting error: {}'.format(e))
                if wait < 1800:
                    wait *= 2
                self.wait.wait(wait)
            else:
                self.conn.loop_start()
                wait = False

    def run(self) -> None:
        self._first_connect()
        if not self.work:
            return
        for i in self._workers.values():
            for worker in i:
                worker.start()
        while self.work:
            data = self._q.get(block=True)
            if isinstance(data, list):
                self.conn.publish(*data)
        for i in self._workers.values():
            for worker in i:
                worker.join()
