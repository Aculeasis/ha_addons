import signal
import threading
import time


class SignalHandler:
    def __init__(self, signals=(signal.SIGINT, signal.SIGTERM)):
        super().__init__()
        self._sleep = threading.Event()
        self._death_time = 0
        self._wakeup = None
        [signal.signal(signal_, self._signal_handler) for signal_ in signals]

    def _signal_handler(self, _, __):
        self._sleep.set()

    def set_wakeup_callback(self, wakeup):
        self._wakeup = wakeup

    def die_in(self, sec: int):
        self._death_time = sec
        self._sleep.set()

    def interrupted(self) -> bool:
        return self._sleep.is_set()

    def sleep(self, sleep_time):
        self._sleep.wait(sleep_time)
        if self._wakeup:
            self._wakeup()
        if self._death_time:
            time.sleep(self._death_time)
