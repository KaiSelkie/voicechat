const express = require("express");
const app = express();
const http = require("http").createServer(app);
const io = require("socket.io")(http);

app.use(express.static("public"));

const users = {};

function sendUserList(channel) {
  if (!channel) return;

  const usersInChannel = Object.entries(users)
    .filter(([id, user]) => user.channel === channel)
    .map(([id, user]) => ({
      id,
      username: user.username,
      speaking: !!user.speaking,
	  muted: !!user.muted
    }));

  io.to(channel).emit("user-list", usersInChannel);
}

io.on("connection", (socket) => {
  console.log("Usuario conectado:", socket.id);

  socket.on("join-channel", ({ username, channel }) => {
    users[socket.id] = {
      username,
      channel,
      speaking: false,
	  muted: false
    };

    socket.join(channel);

    socket.to(channel).emit("user-connected", {
      socketId: socket.id,
      username
    });

    sendUserList(channel);
  });

  socket.on("leave-channel", () => {
    const user = users[socket.id];
    if (!user || !user.channel) return;

    const oldChannel = user.channel;

    socket.leave(oldChannel);

    socket.to(oldChannel).emit("user-disconnected", {
      socketId: socket.id
    });

    users[socket.id] = {
      ...user,
      channel: null,
      speaking: false,
	  muted: false
    };

    sendUserList(oldChannel);
  });

  socket.on("switch-channel", ({ username, oldChannel, newChannel }) => {
    if (oldChannel) {
      socket.leave(oldChannel);

      socket.to(oldChannel).emit("user-disconnected", {
        socketId: socket.id
      });

      sendUserList(oldChannel);
    }

    users[socket.id] = {
      username,
      channel: newChannel,
      speaking: false,
	  muted: false
    };

    socket.join(newChannel);

    socket.to(newChannel).emit("user-connected", {
      socketId: socket.id,
      username
    });

    sendUserList(newChannel);
  });

  socket.on("user-speaking", ({ speaking }) => {
    const user = users[socket.id];
    if (!user || !user.channel) return;

    user.speaking = !!speaking;

    socket.to(user.channel).emit("speaking-update", {
      socketId: socket.id,
      speaking: user.speaking
    });
  });

  socket.on("user-muted", ({ muted }) => {
    const user = users[socket.id];
    if (!user || !user.channel) return;
 
    user.muted = !!muted;

  io.to(user.channel).emit("mute-update", {
    socketId: socket.id,
    muted: user.muted
    });
  });

  socket.on("offer", ({ target, offer }) => {
    io.to(target).emit("offer", {
      sender: socket.id,
      offer
    });
  });
  socket.on("offer", ({ target, offer }) => {
    io.to(target).emit("offer", {
      sender: socket.id,
      offer
    });
  });

  socket.on("answer", ({ target, answer }) => {
    io.to(target).emit("answer", {
      sender: socket.id,
      answer
    });
  });

  socket.on("ice-candidate", ({ target, candidate }) => {
    io.to(target).emit("ice-candidate", {
      sender: socket.id,
      candidate
    });
  });

  socket.on("disconnect", () => {
    const user = users[socket.id];

    if (user && user.channel) {
      const oldChannel = user.channel;

      socket.to(oldChannel).emit("user-disconnected", {
        socketId: socket.id
      });

      delete users[socket.id];
      sendUserList(oldChannel);
    } else {
      delete users[socket.id];
    }

    console.log("Usuario desconectado:", socket.id);
  });
});

const PORT = process.env.PORT || 3000;

http.listen(PORT, "0.0.0.0", () => {
  console.log(`Servidor iniciado en puerto ${PORT}`);
});